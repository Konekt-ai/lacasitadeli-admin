-- ============================================================
-- crear_tablas_recepcion.sql
-- Ejecutar en SQL Server Management Studio (base: compucaja)
-- Compatible con SQL Server 2014. Seguro de ejecutar multiples veces (idempotente).
--
-- Agrega el flujo de recepcion de trailer con conversion caja -> pieza:
--   1. productos_compra        -> equivalencias SKU proveedor / caja -> pieza
--   2. recepciones_esperadas   -> precaptura desde factura / packing list (NO toca stock)
--   3. recepciones_reales      -> recepcion fisica por cajas + destino
--   4. sp_confirmar_recepcion  -> convierte cajas a piezas y escribe inventario + movimientos
--   5. vistas de equivalencias y discrepancias
--
-- NOTA IMPORTANTE: El catalogo maestro de productos YA EXISTE en
--   [compucaja].[dbo].[VArticulosUnificados] (Art_GTIN, Art_Descripcion).
--   No se duplica. Las tablas nuevas lo referencian por codigo_barras = Art_GTIN
--   (referencia logica, sin FK, igual que tu inventario_bodega actual).
-- ============================================================
USE [compucaja]
GO

-- =====================================================================
-- 1. EQUIVALENCIAS  (SKU proveedor -> producto interno, caja -> pieza)
-- =====================================================================
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='productos_compra' AND xtype='U')
BEGIN
    CREATE TABLE productos_compra (
      id                    INT           IDENTITY(1,1) PRIMARY KEY,
      proveedor             VARCHAR(100)  NOT NULL DEFAULT '',   -- nombre del proveedor
      sku_proveedor         VARCHAR(50)   NOT NULL,              -- codigo tal como viene en la factura
      descripcion_proveedor VARCHAR(200)  NULL,                  -- texto del proveedor (puede diferir del interno)
      unidad_compra         VARCHAR(20)   NOT NULL DEFAULT 'Caja',  -- Caja / Case / Bulto...
      piezas_por_caja       INT           NOT NULL DEFAULT 1,    -- *** la equivalencia clave ***
      codigo_barras         VARCHAR(50)   NOT NULL,              -- producto interno = Art_GTIN
      activo                BIT           NOT NULL DEFAULT 1,
      creado                DATETIME      NOT NULL DEFAULT GETDATE(),
      CONSTRAINT UQ_prodcompra UNIQUE (proveedor, sku_proveedor)
    );
    CREATE INDEX ix_prodcompra_codigo ON productos_compra(codigo_barras);
END
GO

-- =====================================================================
-- 2. RECEPCION ESPERADA  (precaptura factura / packing list, NO toca stock)
-- =====================================================================
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='recepciones_esperadas' AND xtype='U')
BEGIN
    CREATE TABLE recepciones_esperadas (
      id                INT          IDENTITY(1,1) PRIMARY KEY,
      referencia        VARCHAR(60)  NULL,         -- folio factura / packing list
      proveedor         VARCHAR(100) NULL,
      fecha_esperada    DATE         NULL,
      destino_esperado  VARCHAR(50)  NULL,         -- ubicacion tentativa
      estatus           VARCHAR(20)  NOT NULL DEFAULT 'Pendiente',  -- Pendiente/Parcial/Recibida/Cancelada
      notas             VARCHAR(300) NULL,
      creado            DATETIME     NOT NULL DEFAULT GETDATE()
    );
END
GO

IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='recepciones_esperadas_detalle' AND xtype='U')
BEGIN
    CREATE TABLE recepciones_esperadas_detalle (
      id               INT          IDENTITY(1,1) PRIMARY KEY,
      recepcion_id     INT          NOT NULL,
      codigo_barras    VARCHAR(50)  NOT NULL,
      sku_proveedor    VARCHAR(50)  NULL,
      cajas_esperadas  INT          NOT NULL DEFAULT 0,
      piezas_por_caja  INT          NOT NULL DEFAULT 1,  -- snapshot al momento de la precaptura
      notas            VARCHAR(200) NULL,
      CONSTRAINT FK_recep_esp_det FOREIGN KEY (recepcion_id)
          REFERENCES recepciones_esperadas(id)
    );
    CREATE INDEX ix_recep_esp_det ON recepciones_esperadas_detalle(recepcion_id);
END
GO

-- =====================================================================
-- 3. RECEPCION REAL  (recepcion fisica por cajas + destino)
-- =====================================================================
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='recepciones_reales' AND xtype='U')
BEGIN
    CREATE TABLE recepciones_reales (
      id                    INT          IDENTITY(1,1) PRIMARY KEY,
      recepcion_esperada_id INT          NULL,     -- NULL = llego sin aviso previo
      fecha_real            DATETIME     NOT NULL DEFAULT GETDATE(),
      recibido_por          VARCHAR(60)  NULL,
      estatus               VARCHAR(20)  NOT NULL DEFAULT 'Abierta',  -- Abierta/Confirmada/Cancelada
      confirmada            BIT          NOT NULL DEFAULT 0,          -- 1 = ya escribio inventario
      notas                 VARCHAR(300) NULL,
      creado                DATETIME     NOT NULL DEFAULT GETDATE(),
      CONSTRAINT FK_recep_real_esp FOREIGN KEY (recepcion_esperada_id)
          REFERENCES recepciones_esperadas(id)
    );
END
GO

IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='recepciones_reales_detalle' AND xtype='U')
BEGIN
    CREATE TABLE recepciones_reales_detalle (
      id                 INT          IDENTITY(1,1) PRIMARY KEY,
      recepcion_real_id  INT          NOT NULL,
      codigo_barras      VARCHAR(50)  NOT NULL,
      ubicacion          VARCHAR(50)  NOT NULL DEFAULT 'Bodega',  -- destino fisico
      cajas_recibidas    INT          NOT NULL DEFAULT 0,
      piezas_por_caja    INT          NOT NULL DEFAULT 1,
      piezas_resultantes AS (cajas_recibidas * piezas_por_caja) PERSISTED,  -- conversion automatica
      lote               VARCHAR(50)  NULL,        -- opcional (perecederos / frio)
      caducidad          DATE         NULL,        -- opcional (FEFO)
      notas              VARCHAR(200) NULL,
      CONSTRAINT FK_recep_real_det FOREIGN KEY (recepcion_real_id)
          REFERENCES recepciones_reales(id)
    );
    CREATE INDEX ix_recep_real_det ON recepciones_reales_detalle(recepcion_real_id);
END
GO

-- =====================================================================
-- 4. PROCEDIMIENTO: confirmar recepcion real
--    Convierte cajas -> piezas, hace upsert en inventario_bodega
--    y escribe el ledger en movimientos_bodega.
--    Tiene candado para no aplicar dos veces la misma recepcion.
-- =====================================================================
IF OBJECT_ID('sp_confirmar_recepcion') IS NOT NULL
    DROP PROCEDURE sp_confirmar_recepcion;
GO
CREATE PROCEDURE sp_confirmar_recepcion
    @recepcion_real_id INT
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM recepciones_reales WHERE id = @recepcion_real_id)
    BEGIN
        RAISERROR('No existe la recepcion real %d.', 16, 1, @recepcion_real_id);
        RETURN;
    END

    IF EXISTS (SELECT 1 FROM recepciones_reales WHERE id = @recepcion_real_id AND confirmada = 1)
    BEGIN
        RAISERROR('La recepcion %d ya fue confirmada; no se vuelve a aplicar.', 16, 1, @recepcion_real_id);
        RETURN;
    END

    BEGIN TRY
        BEGIN TRAN;

        DECLARE @codigo VARCHAR(50), @ubic VARCHAR(50), @piezas INT,
                @lote VARCHAR(50), @cad DATE, @antes INT, @despues INT, @nota VARCHAR(200);

        DECLARE cur CURSOR LOCAL FAST_FORWARD FOR
            SELECT codigo_barras, ubicacion, piezas_resultantes, lote, caducidad
            FROM recepciones_reales_detalle
            WHERE recepcion_real_id = @recepcion_real_id
              AND piezas_resultantes > 0;

        OPEN cur;
        FETCH NEXT FROM cur INTO @codigo, @ubic, @piezas, @lote, @cad;

        WHILE @@FETCH_STATUS = 0
        BEGIN
            -- IMPORTANTE: reiniciar @antes en cada vuelta para no arrastrar el valor anterior
            SET @antes = NULL;
            SELECT @antes = cantidad
            FROM inventario_bodega
            WHERE codigo_barras = @codigo AND ubicacion = @ubic;

            SET @antes   = ISNULL(@antes, 0);
            SET @despues = @antes + @piezas;

            -- Upsert de existencias (llave: codigo_barras + ubicacion)
            IF EXISTS (SELECT 1 FROM inventario_bodega WHERE codigo_barras = @codigo AND ubicacion = @ubic)
                UPDATE inventario_bodega
                   SET cantidad = @despues, ultima_entrada = GETDATE()
                 WHERE codigo_barras = @codigo AND ubicacion = @ubic;
            ELSE
                INSERT INTO inventario_bodega (codigo_barras, ubicacion, cantidad, ultima_entrada)
                VALUES (@codigo, @ubic, @piezas, GETDATE());

            -- Traza de lote/caducidad en el movimiento (el stock es por codigo+ubicacion)
            SET @nota = 'Recepcion #' + CAST(@recepcion_real_id AS VARCHAR(12))
                      + CASE WHEN @lote IS NOT NULL THEN ' Lote:' + @lote ELSE '' END
                      + CASE WHEN @cad  IS NOT NULL THEN ' Cad:' + CONVERT(VARCHAR(10), @cad, 23) ELSE '' END;

            INSERT INTO movimientos_bodega
                (codigo_barras, tipo, cantidad, ubicacion, stock_antes, stock_despues, motivo, area, notas)
            VALUES
                (@codigo, 'ENTRADA', @piezas, @ubic, @antes, @despues, 'Recepcion', 'Bodega', @nota);

            FETCH NEXT FROM cur INTO @codigo, @ubic, @piezas, @lote, @cad;
        END

        CLOSE cur; DEALLOCATE cur;

        -- Marcar la recepcion real como confirmada
        UPDATE recepciones_reales
           SET confirmada = 1, estatus = 'Confirmada'
         WHERE id = @recepcion_real_id;

        -- Si venia de una recepcion esperada, marcarla recibida
        UPDATE recepciones_esperadas
           SET estatus = 'Recibida'
         WHERE id = (SELECT recepcion_esperada_id FROM recepciones_reales WHERE id = @recepcion_real_id)
           AND estatus <> 'Recibida';

        COMMIT;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK;
        IF CURSOR_STATUS('local','cur') >= 0 BEGIN CLOSE cur; DEALLOCATE cur; END
        DECLARE @msg NVARCHAR(2048) = ERROR_MESSAGE();
        RAISERROR(@msg, 16, 1);
    END CATCH
END
GO

-- =====================================================================
-- 5. VISTAS
-- =====================================================================

-- 5a. Equivalencias legibles (SKU proveedor -> producto interno con su nombre)
IF OBJECT_ID('v_equivalencias') IS NOT NULL DROP VIEW v_equivalencias;
GO
CREATE VIEW v_equivalencias AS
SELECT
  pc.id,
  pc.proveedor,
  pc.sku_proveedor,
  pc.descripcion_proveedor,
  pc.unidad_compra,
  pc.piezas_por_caja,
  pc.codigo_barras,
  v.Art_Descripcion AS nombre_interno,
  pc.activo
FROM productos_compra pc
LEFT JOIN [compucaja].[dbo].[VArticulosUnificados] v
       ON v.Art_GTIN = pc.codigo_barras;
GO

-- 5b. Discrepancias: esperado vs recibido (en cajas) por recepcion y producto
IF OBJECT_ID('v_recepcion_discrepancias') IS NOT NULL DROP VIEW v_recepcion_discrepancias;
GO
CREATE VIEW v_recepcion_discrepancias AS
SELECT
  re.id                                AS recepcion_esperada_id,
  re.referencia,
  re.proveedor,
  esp.codigo_barras,
  SUM(ISNULL(esp.cajas_esperadas, 0))  AS cajas_esperadas,
  ISNULL(rec.cajas_recibidas, 0)       AS cajas_recibidas,
  ISNULL(rec.cajas_recibidas, 0) - SUM(ISNULL(esp.cajas_esperadas, 0)) AS diferencia_cajas
FROM recepciones_esperadas re
JOIN recepciones_esperadas_detalle esp ON esp.recepcion_id = re.id
LEFT JOIN (
    SELECT rr.recepcion_esperada_id, rrd.codigo_barras,
           SUM(rrd.cajas_recibidas) AS cajas_recibidas
    FROM recepciones_reales rr
    JOIN recepciones_reales_detalle rrd ON rrd.recepcion_real_id = rr.id
    WHERE rr.confirmada = 1
    GROUP BY rr.recepcion_esperada_id, rrd.codigo_barras
) rec ON rec.recepcion_esperada_id = re.id
     AND rec.codigo_barras = esp.codigo_barras
GROUP BY re.id, re.referencia, re.proveedor, esp.codigo_barras, rec.cajas_recibidas;
GO

-- =====================================================================
-- 6. PRECIOS DE COMPRA  (costo real desde las facturas/recepciones)
--    Aditivo e idempotente. NO toca tablas de NovaCaja.
--    El costo de NovaCaja (Art_UltimoCosto) viene incompleto/inconsistente,
--    asi que capturamos el precio de compra real de cada factura para que el
--    margen sea exacto. El precio de VENTA se lee de NovaCaja (ListaPreciosArt).
-- =====================================================================

-- 6a. productos_compra: ultimo precio de compra por proveedor+sku
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('productos_compra') AND name='precio_compra_caja')
    ALTER TABLE productos_compra ADD precio_compra_caja DECIMAL(18,4) NULL;   -- costo por caja (factura)
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('productos_compra') AND name='precio_compra_pieza')
    ALTER TABLE productos_compra ADD precio_compra_pieza DECIMAL(18,4) NULL;  -- costo por pieza (= caja / piezas_por_caja)
GO

-- 6b. recepciones_esperadas_detalle: precio de la factura (precaptura)
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('recepciones_esperadas_detalle') AND name='precio_compra_caja')
    ALTER TABLE recepciones_esperadas_detalle ADD precio_compra_caja DECIMAL(18,4) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('recepciones_esperadas_detalle') AND name='precio_compra_pieza')
    ALTER TABLE recepciones_esperadas_detalle ADD precio_compra_pieza DECIMAL(18,4) NULL;
GO

-- 6c. recepciones_reales_detalle: costo por pieza al recibir (snapshot)
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('recepciones_reales_detalle') AND name='precio_compra_pieza')
    ALTER TABLE recepciones_reales_detalle ADD precio_compra_pieza DECIMAL(18,4) NULL;
GO

-- 6d. costos_producto: FUENTE UNICA del costo real por producto (por pieza).
--     Se actualiza al confirmar una recepcion con el precio de la factura.
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='costos_producto' AND xtype='U')
BEGIN
    CREATE TABLE costos_producto (
      codigo_barras  VARCHAR(50)   NOT NULL PRIMARY KEY,        -- = Art_Codigo (resuelto)
      precio_compra  DECIMAL(18,4) NOT NULL DEFAULT 0,          -- costo real por pieza (ultima factura)
      precio_venta   DECIMAL(18,4) NULL,                        -- precio de venta efectivo (relleno)
      proveedor      VARCHAR(100)  NULL,                        -- de quien se compro
      fuente         VARCHAR(20)   NOT NULL DEFAULT 'factura',  -- factura | estimado | manual
      actualizado    DATETIME      NOT NULL DEFAULT GETDATE()
    );
END
GO
-- precio_venta para instalaciones que ya tenian costos_producto
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID('costos_producto') AND name='precio_venta')
    ALTER TABLE costos_producto ADD precio_venta DECIMAL(18,4) NULL;
GO

-- =====================================================================
-- 7. VISTA UNIFICADA DE COSTO Y PRECIO  (base del calculo exacto)
--    Por producto: costo (nuestro precio de compra -> respaldo NovaCaja),
--    precio de venta (lista de NovaCaja con impuestos) y el margen.
-- =====================================================================
IF OBJECT_ID('v_costos_producto') IS NOT NULL DROP VIEW v_costos_producto;
GO
CREATE VIEW v_costos_producto AS
SELECT
  a.Art_Codigo                                                        AS codigo_barras,
  a.Art_Descripcion                                                   AS nombre,
  cp.precio_compra                                                    AS costo_factura,    -- nuestro (facturas/estimado)
  a.Art_UltimoCosto                                                   AS costo_novacaja,   -- respaldo
  -- COSTO EXACTO con respaldos: factura/estimado -> ultimo costo -> reposicion
  COALESCE(NULLIF(cp.precio_compra,0), NULLIF(a.Art_UltimoCosto,0), NULLIF(a.Art_CostoReposicion,0)) AS precio_compra,
  -- PRECIO DE VENTA con respaldos: lista NovaCaja -> relleno (ticket/derivado)
  COALESCE(NULLIF(lp.LPA_PrecioVentaImp,0), NULLIF(cp.precio_venta,0))                               AS precio_venta,
  COALESCE(NULLIF(lp.LPA_PrecioVentaImp,0), NULLIF(cp.precio_venta,0))
    - COALESCE(NULLIF(cp.precio_compra,0), NULLIF(a.Art_UltimoCosto,0), NULLIF(a.Art_CostoReposicion,0)) AS margen_unitario,
  CASE WHEN COALESCE(NULLIF(lp.LPA_PrecioVentaImp,0), NULLIF(cp.precio_venta,0)) > 0
       THEN CAST((COALESCE(NULLIF(lp.LPA_PrecioVentaImp,0), NULLIF(cp.precio_venta,0))
                  - COALESCE(NULLIF(cp.precio_compra,0), NULLIF(a.Art_UltimoCosto,0), NULLIF(a.Art_CostoReposicion,0)))
                 / COALESCE(NULLIF(lp.LPA_PrecioVentaImp,0), NULLIF(cp.precio_venta,0)) * 100 AS DECIMAL(6,2))
       END                                                            AS margen_pct,
  CASE WHEN NULLIF(cp.precio_compra,0) IS NOT NULL AND cp.fuente = 'factura' THEN 'factura'
       WHEN NULLIF(cp.precio_compra,0) IS NOT NULL                          THEN 'estimado'
       WHEN NULLIF(a.Art_UltimoCosto,0) IS NOT NULL                         THEN 'novacaja'
       WHEN NULLIF(a.Art_CostoReposicion,0) IS NOT NULL                     THEN 'reposicion'
       ELSE 'sin_costo' END                                           AS fuente_costo
FROM [compucaja].[dbo].[VArticulosUnificados] a
LEFT JOIN costos_producto cp ON cp.codigo_barras = a.Art_Codigo
OUTER APPLY (
  SELECT TOP 1 l.LPA_PrecioVentaImp
  FROM [compucaja].[dbo].[ListaPreciosArt] l
  WHERE l.Art_Codigo = a.Art_Codigo
  ORDER BY l.LP_Codigo
) lp;
GO

-- =====================================================================
-- 8. RELLENO de costo/precio para productos CON VENTAS sin registro propio.
--    Evita huecos que rompan ganancia/inversion. Usa SOLO lo que el producto
--    ya tiene (NovaCaja): ultimo costo -> reposicion -> derivado del precio;
--    precio de venta: lista -> promedio real de tickets -> costo*factor.
--    NO sobreescribe lo capturado de facturas (solo inserta lo que falta).
--    Acotado a productos con ventas (no recorre todo el catalogo).
-- =====================================================================
INSERT INTO costos_producto (codigo_barras, precio_compra, precio_venta, proveedor, fuente, actualizado)
SELECT
  s.producto,
  -- costo derivado (estos productos NO tienen costo real): precio/factor -> ticket/1.30
  COALESCE(NULLIF(lp.LPA_PrecioVentaImp / NULLIF(lp.LPA_UtilidadFactor,0), 0),
           NULLIF(s.precioTicket / 1.30, 0), 0)                                              AS precio_compra,
  -- precio de venta: lista -> promedio real de tickets
  COALESCE(NULLIF(lp.LPA_PrecioVentaImp,0), NULLIF(s.precioTicket,0), 0)                      AS precio_venta,
  NULL, 'estimado', GETDATE()
FROM (
  SELECT v.producto,
         AVG(NULLIF(v.importe / NULLIF(v.cantidad,0), 0)) AS precioTicket
  FROM [compucaja].[dbo].[VBasePolizaVentas] v WITH (NOLOCK)
  WHERE v.Fecha >= DATEADD(DAY, -90, (SELECT MAX(Fecha) FROM [compucaja].[dbo].[VBasePolizaVentas]))
    AND v.producto IS NOT NULL AND v.producto <> '' AND v.producto <> '0'
  GROUP BY v.producto
) s
LEFT JOIN [compucaja].[dbo].[VArticulosUnificados] a WITH (NOLOCK) ON a.Art_Codigo = s.producto
OUTER APPLY (
  SELECT TOP 1 l.LPA_PrecioVentaImp, l.LPA_UtilidadFactor
  FROM [compucaja].[dbo].[ListaPreciosArt] l WHERE l.Art_Codigo = s.producto ORDER BY l.LP_Codigo
) lp
WHERE NOT EXISTS (SELECT 1 FROM costos_producto cp WHERE cp.codigo_barras = s.producto)
  -- solo huecos reales: el producto NO tiene costo en NovaCaja
  AND COALESCE(NULLIF(a.Art_UltimoCosto,0), NULLIF(a.Art_CostoReposicion,0)) IS NULL;
GO

-- ============================================================
-- FIN. Ejemplo de uso del flujo completo:
--
-- 1) Cargar equivalencia una sola vez por producto:
--    INSERT INTO productos_compra (proveedor, sku_proveedor, descripcion_proveedor, piezas_por_caja, codigo_barras)
--    VALUES ('Proveedor X', 'SKU-A', 'Caja producto A', 12, '7501234567890');
--
-- 2) Precaptura (factura / packing list) -> NO toca stock:
--    INSERT INTO recepciones_esperadas (referencia, proveedor, fecha_esperada)
--    VALUES ('FAC-001', 'Proveedor X', '2026-06-02');
--    -- (usar SCOPE_IDENTITY() para el detalle)
--
-- 3) Recepcion fisica al bajar el trailer (por cajas + destino):
--    INSERT INTO recepciones_reales (recepcion_esperada_id, recibido_por) VALUES (1, 'Juan');
--    INSERT INTO recepciones_reales_detalle (recepcion_real_id, codigo_barras, ubicacion, cajas_recibidas, piezas_por_caja)
--    VALUES (1, '7501234567890', 'Casita 1', 3, 12);   -- 3 cajas -> 36 piezas
--
-- 4) Confirmar -> aqui se convierte y se escribe inventario + movimientos:
--    EXEC sp_confirmar_recepcion @recepcion_real_id = 1;
--
-- 5) Revisar diferencias:
--    SELECT * FROM v_recepcion_discrepancias WHERE recepcion_esperada_id = 1;
-- ============================================================
