-- ============================================================
--  La Casita Admin - Schema SQL Server
--  Ejecutar UNA sola vez con: node infra/init-sqlserver.js
-- ============================================================

-- Crear base de datos si no existe
IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = 'lacasita_admin')
    CREATE DATABASE lacasita_admin;
GO

USE lacasita_admin;
GO

-- ── Categorias ───────────────────────────────────────────────
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'categorias')
BEGIN
    CREATE TABLE categorias (
        id          INT IDENTITY(1,1) PRIMARY KEY,
        nombre      NVARCHAR(100) NOT NULL,
        descripcion NVARCHAR(500),
        activo      BIT DEFAULT 1,
        created_at  DATETIME2 DEFAULT GETDATE(),
        CONSTRAINT uq_categorias_nombre UNIQUE (nombre)
    );
END
GO

-- ── Productos ────────────────────────────────────────────────
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'productos')
BEGIN
    CREATE TABLE productos (
        id               INT IDENTITY(1,1) PRIMARY KEY,
        codigo_barras    NVARCHAR(100),
        nombre           NVARCHAR(255) NOT NULL,
        descripcion      NVARCHAR(MAX),
        precio_compra    DECIMAL(12,2) DEFAULT 0,
        precio_venta     DECIMAL(12,2) NOT NULL,
        precio_mayoreo   DECIMAL(12,2),
        cantidad_mayoreo INT,
        stock_actual     INT DEFAULT 0,
        stock_minimo     INT DEFAULT 5,
        imagen_url       NVARCHAR(MAX),
        activo           BIT DEFAULT 1,
        visible_web      BIT DEFAULT 1,
        categoria_id     INT REFERENCES categorias(id),
        created_at       DATETIME2 DEFAULT GETDATE(),
        updated_at       DATETIME2 DEFAULT GETDATE(),
        CONSTRAINT uq_productos_barcode UNIQUE (codigo_barras)
    );
END
GO

-- ── Usuarios ─────────────────────────────────────────────────
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'usuarios')
BEGIN
    CREATE TABLE usuarios (
        id            UNIQUEIDENTIFIER DEFAULT NEWID() PRIMARY KEY,
        nombre        NVARCHAR(100) NOT NULL,
        email         NVARCHAR(255) NOT NULL,
        password_hash NVARCHAR(255),
        rol           NVARCHAR(50) DEFAULT 'cajero',
        activo        BIT DEFAULT 1,
        created_at    DATETIME2 DEFAULT GETDATE(),
        CONSTRAINT uq_usuarios_email UNIQUE (email)
    );

    -- Usuario administrador por defecto
    INSERT INTO usuarios (nombre, email, password_hash, rol)
    VALUES ('Administrador', 'admin@lacasita.com', '$2b$10$placeholder_default', 'admin');
END
GO

-- ── Ventas ───────────────────────────────────────────────────
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ventas')
BEGIN
    CREATE TABLE ventas (
        id          UNIQUEIDENTIFIER DEFAULT NEWID() PRIMARY KEY,
        folio       NVARCHAR(50) NOT NULL,
        canal       NVARCHAR(50) DEFAULT 'caja',
        usuario_id  UNIQUEIDENTIFIER REFERENCES usuarios(id),
        metodo_pago NVARCHAR(50) DEFAULT 'efectivo',
        total       DECIMAL(12,2) DEFAULT 0,
        estado      NVARCHAR(20) DEFAULT 'completada',
        notas       NVARCHAR(MAX),
        created_at  DATETIME2 DEFAULT GETDATE(),
        CONSTRAINT uq_ventas_folio UNIQUE (folio)
    );
END
GO

-- ── Detalle de venta ─────────────────────────────────────────
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'detalle_venta')
BEGIN
    CREATE TABLE detalle_venta (
        id              INT IDENTITY(1,1) PRIMARY KEY,
        venta_id        UNIQUEIDENTIFIER REFERENCES ventas(id) ON DELETE CASCADE,
        producto_id     INT REFERENCES productos(id),
        nombre_producto NVARCHAR(255),
        cantidad        DECIMAL(12,3) NOT NULL,
        precio_unitario DECIMAL(12,2) NOT NULL,
        subtotal        DECIMAL(12,2) NOT NULL
    );
END
GO

-- ── Movimientos de inventario ─────────────────────────────────
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'movimientos_inventario')
BEGIN
    CREATE TABLE movimientos_inventario (
        id           INT IDENTITY(1,1) PRIMARY KEY,
        producto_id  INT REFERENCES productos(id),
        tipo         NVARCHAR(50) NOT NULL,
        cantidad     DECIMAL(12,3) NOT NULL,
        stock_antes  DECIMAL(12,3) NOT NULL,
        stock_despues DECIMAL(12,3) NOT NULL,
        motivo       NVARCHAR(MAX),
        usuario_id   UNIQUEIDENTIFIER,
        created_at   DATETIME2 DEFAULT GETDATE()
    );
END
GO

PRINT 'Schema lacasita_admin creado correctamente.';
GO
