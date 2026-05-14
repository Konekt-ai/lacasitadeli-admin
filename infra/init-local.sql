-- ============================================================
--  La Casita Admin — Schema completo PostgreSQL local
--  Ejecutar con: node infra/init-local.js
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Categorias ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS categorias (
    id          SERIAL PRIMARY KEY,
    nombre      VARCHAR(100) NOT NULL UNIQUE,
    descripcion TEXT,
    activo      BOOLEAN DEFAULT TRUE,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ── Productos ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS productos (
    id               SERIAL PRIMARY KEY,
    codigo_barras    VARCHAR(100) UNIQUE,
    nombre           VARCHAR(255) NOT NULL,
    descripcion      TEXT,
    precio_compra    DECIMAL(12,2) DEFAULT 0,
    precio_venta     DECIMAL(12,2) NOT NULL,
    precio_mayoreo   DECIMAL(12,2),
    cantidad_mayoreo INTEGER,
    stock_actual     INTEGER DEFAULT 0,
    stock_minimo     INTEGER DEFAULT 5,
    imagen_url       TEXT,
    activo           BOOLEAN DEFAULT TRUE,
    visible_web      BOOLEAN DEFAULT TRUE,
    categoria_id     INTEGER REFERENCES categorias(id),
    created_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ── Usuarios ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS usuarios (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre        VARCHAR(100) NOT NULL,
    email         VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255),
    rol           VARCHAR(50) DEFAULT 'cajero',
    activo        BOOLEAN DEFAULT TRUE,
    created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO usuarios (nombre, email, password_hash, rol)
VALUES ('Administrador', 'admin@lacasita.com', '$2b$10$placeholder_default', 'admin')
ON CONFLICT (email) DO NOTHING;

-- ── Ventas ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ventas (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    folio       VARCHAR(50) NOT NULL UNIQUE,
    canal       VARCHAR(50) DEFAULT 'caja',
    usuario_id  UUID REFERENCES usuarios(id),
    metodo_pago VARCHAR(50) DEFAULT 'efectivo',
    total       DECIMAL(12,2) DEFAULT 0,
    estado      VARCHAR(20) DEFAULT 'completada',
    notas       TEXT,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ── Detalle de venta ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS detalle_venta (
    id              SERIAL PRIMARY KEY,
    venta_id        UUID REFERENCES ventas(id) ON DELETE CASCADE,
    producto_id     INTEGER REFERENCES productos(id),
    nombre_producto VARCHAR(255),
    cantidad        DECIMAL(12,3) NOT NULL,
    precio_unitario DECIMAL(12,2) NOT NULL,
    subtotal        DECIMAL(12,2) NOT NULL
);

-- ── Movimientos de inventario ─────────────────────────────────
CREATE TABLE IF NOT EXISTS movimientos_inventario (
    id            SERIAL PRIMARY KEY,
    producto_id   INTEGER REFERENCES productos(id),
    tipo          VARCHAR(50) NOT NULL,
    cantidad      DECIMAL(12,3) NOT NULL,
    stock_antes   DECIMAL(12,3) NOT NULL,
    stock_despues DECIMAL(12,3) NOT NULL,
    motivo        TEXT,
    usuario_id    UUID,
    created_at    TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ── Función para registrar venta atómica ─────────────────────
CREATE OR REPLACE FUNCTION registrar_venta(
    p_folio       VARCHAR,
    p_canal       VARCHAR,
    p_usuario_id  UUID,
    p_metodo_pago VARCHAR,
    p_items       JSONB
) RETURNS UUID AS $$
DECLARE
    v_venta_id      UUID;
    v_item          RECORD;
    v_total         DECIMAL(12,2) := 0;
    v_nombre        VARCHAR;
    v_stock         DECIMAL(12,3);
    v_subtotal      DECIMAL(12,2);
BEGIN
    INSERT INTO ventas (folio, canal, usuario_id, metodo_pago, total)
    VALUES (p_folio, p_canal, p_usuario_id, p_metodo_pago, 0)
    RETURNING id INTO v_venta_id;

    FOR v_item IN
        SELECT * FROM jsonb_to_recordset(p_items)
        AS x(producto_id INT, cantidad DECIMAL, precio_unitario DECIMAL)
    LOOP
        SELECT nombre, stock_actual INTO v_nombre, v_stock
        FROM productos WHERE id = v_item.producto_id FOR UPDATE;

        IF v_nombre IS NULL THEN
            RAISE EXCEPTION 'Producto con ID % no encontrado', v_item.producto_id;
        END IF;

        v_subtotal := v_item.cantidad * v_item.precio_unitario;
        v_total    := v_total + v_subtotal;

        INSERT INTO detalle_venta
            (venta_id, producto_id, nombre_producto, cantidad, precio_unitario, subtotal)
        VALUES (v_venta_id, v_item.producto_id, v_nombre, v_item.cantidad, v_item.precio_unitario, v_subtotal);

        UPDATE productos
        SET stock_actual = stock_actual - v_item.cantidad,
            updated_at   = CURRENT_TIMESTAMP
        WHERE id = v_item.producto_id;

        INSERT INTO movimientos_inventario
            (producto_id, tipo, cantidad, stock_antes, stock_despues, motivo, usuario_id)
        VALUES (v_item.producto_id, 'venta', -v_item.cantidad, v_stock,
                v_stock - v_item.cantidad, 'Venta ' || p_folio, p_usuario_id);
    END LOOP;

    UPDATE ventas SET total = v_total WHERE id = v_venta_id;
    RETURN v_venta_id;
END;
$$ LANGUAGE plpgsql;
