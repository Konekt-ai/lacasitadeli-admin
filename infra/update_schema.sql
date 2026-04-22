-- Migración para agregar todos los campos necesarios a la tabla productos y crear tablas de ventas
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Asegurar que la tabla productos tenga todas las columnas requeridas por el API
DO $$
BEGIN
    -- Campos de Mayoreo
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='productos' AND column_name='precio_mayoreo') THEN
        ALTER TABLE productos ADD COLUMN precio_mayoreo DECIMAL(12, 2);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='productos' AND column_name='cantidad_mayoreo') THEN
        ALTER TABLE productos ADD COLUMN cantidad_mayoreo INTEGER;
    END IF;

    -- Campos de Inventario y Control
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='productos' AND column_name='stock_actual') THEN
        ALTER TABLE productos ADD COLUMN stock_actual INTEGER DEFAULT 0;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='productos' AND column_name='stock_minimo') THEN
        ALTER TABLE productos ADD COLUMN stock_minimo INTEGER DEFAULT 5;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='productos' AND column_name='imagen_url') THEN
        ALTER TABLE productos ADD COLUMN imagen_url TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='productos' AND column_name='activo') THEN
        ALTER TABLE productos ADD COLUMN activo BOOLEAN DEFAULT TRUE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='productos' AND column_name='visible_web') THEN
        ALTER TABLE productos ADD COLUMN visible_web BOOLEAN DEFAULT TRUE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='productos' AND column_name='categoria_id') THEN
        ALTER TABLE productos ADD COLUMN categoria_id INTEGER;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='productos' AND column_name='updated_at') THEN
        ALTER TABLE productos ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
    END IF;
END $$;

-- Crear tablas de ventas si no existen
CREATE TABLE IF NOT EXISTS ventas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    folio VARCHAR(50) NOT NULL UNIQUE,
    canal VARCHAR(50) DEFAULT 'caja',
    usuario_id UUID,
    metodo_pago VARCHAR(50) DEFAULT 'efectivo',
    total DECIMAL(12, 2) DEFAULT 0,
    estado VARCHAR(20) DEFAULT 'completada',
    notas TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS detalle_venta (
    id SERIAL PRIMARY KEY,
    venta_id UUID REFERENCES ventas(id) ON DELETE CASCADE,
    producto_id INTEGER REFERENCES productos(id),
    nombre_producto VARCHAR(255),
    cantidad DECIMAL(12, 3) NOT NULL,
    precio_unitario DECIMAL(12, 2) NOT NULL,
    subtotal DECIMAL(12, 2) NOT NULL
);

CREATE TABLE IF NOT EXISTS movimientos_inventario (
    id SERIAL PRIMARY KEY,
    producto_id INTEGER REFERENCES productos(id),
    tipo VARCHAR(50) NOT NULL,
    cantidad DECIMAL(12, 3) NOT NULL,
    stock_antes DECIMAL(12, 3) NOT NULL,
    stock_despues DECIMAL(12, 3) NOT NULL,
    motivo TEXT,
    usuario_id UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Función para registrar venta de forma atómica
CREATE OR REPLACE FUNCTION registrar_venta(
    p_folio VARCHAR,
    p_canal VARCHAR,
    p_usuario_id UUID,
    p_metodo_pago VARCHAR,
    p_items JSONB
) RETURNS UUID AS $$
DECLARE
    v_venta_id UUID;
    v_item RECORD;
    v_total DECIMAL(12, 2) := 0;
    v_producto_nombre VARCHAR;
    v_stock_actual DECIMAL(12, 3);
    v_subtotal DECIMAL(12, 2);
BEGIN
    -- Insertar la venta
    INSERT INTO ventas (folio, canal, usuario_id, metodo_pago, total)
    VALUES (p_folio, p_canal, p_usuario_id, p_metodo_pago, 0)
    RETURNING id INTO v_venta_id;

    -- Procesar cada item
    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(producto_id INT, cantidad DECIMAL, precio_unitario DECIMAL)
    LOOP
        -- Obtener info del producto y bloquear fila
        SELECT nombre, stock_actual INTO v_producto_nombre, v_stock_actual
        FROM productos WHERE id = v_item.producto_id FOR UPDATE;

        IF v_producto_nombre IS NULL THEN
            RAISE EXCEPTION 'Producto con ID % no encontrado', v_item.producto_id;
        END IF;

        v_subtotal := v_item.cantidad * v_item.precio_unitario;
        v_total := v_total + v_subtotal;

        -- Insertar detalle
        INSERT INTO detalle_venta (venta_id, producto_id, nombre_producto, cantidad, precio_unitario, subtotal)
        VALUES (v_venta_id, v_item.producto_id, v_producto_nombre, v_item.cantidad, v_item.precio_unitario, v_subtotal);

        -- Actualizar stock
        UPDATE productos
        SET stock_actual = stock_actual - v_item.cantidad,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = v_item.producto_id;

        -- Registrar movimiento
        INSERT INTO movimientos_inventario (producto_id, tipo, cantidad, stock_antes, stock_despues, motivo, usuario_id)
        VALUES (v_item.producto_id, 'venta', -v_item.cantidad, v_stock_actual, v_stock_actual - v_item.cantidad, 'Venta ' || p_folio, p_usuario_id);
    END LOOP;

    -- Actualizar el total de la venta
    UPDATE ventas SET total = v_total WHERE id = v_venta_id;

    RETURN v_venta_id;
END;
$$ LANGUAGE plpgsql;
