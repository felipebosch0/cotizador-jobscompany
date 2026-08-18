// ============================================================
// STOCK DE IPHONES (por unidad), fallback estatico extraido de
// "Stock.xlsx" (hoja "Inventario iPhones", 1173 filas totales en esa
// hoja).
//
// Este archivo es el FALLBACK cuando no se puede leer el stock en vivo
// desde el Google Sheet (ver actualizarStockEnVivo en app.js y ObtenerStock
// en cotizador-appscript/Stock.gs, que es la fuente real). Se actualiza a
// mano solo si hace falta una foto mas actual para pruebas locales.
//
// Se filtraron del excel original SOLO las filas con Estado = "En Stock" o
// "Reservado" (111 de 1173) -- se descartaron "Vendido" (155) porque no es
// stock disponible, y las filas totalmente vacias (907, son filas sin usar
// de la planilla).
//
// OJO, dos cosas para tener en cuenta:
//
// 1) Las "sucursales" de este excel (DEPO, OLMOS, DINO, NUEVO CENTRO,
//    SERVICIO TECNICO) NO coinciden con las 2 sucursales de venta
//    (Shopping / Independencia) -- son los nombres viejos de depositos del
//    sistema anterior. El mapeo a Shopping/Independencia esta en
//    DATA.depositoPorSucursal (data.js); DEPO y SERVICIO TECNICO quedan
//    sin mapear a proposito (no son sucursales de venta).
//
// 2) El nombre del modelo tiene inconsistencias del excel original
//    (espacios de mas, "Iphone" en vez de "iPhone", "17 pro" en
//    minuscula, etc). El matching contra el modelo elegido en el
//    cotizador se hace normalizando (sin espacios de mas, sin mayus/minus)
//    asi que igual encuentra estos casos.
// ============================================================

window.STOCK_IPHONES = [
  { modelo: 'iPhone 11 Pro', capacidad: 128, bateria: 100, color: 'PURPURA', sucursal: 'DEPO', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 11 Pro', capacidad: 256, bateria: 100, color: 'Black', sucursal: 'DEPO', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 12 mini', capacidad: 128, bateria: 100, color: 'BLACK', sucursal: 'DEPO', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 13', capacidad: 128, bateria: 79, color: 'PINK', sucursal: 'DEPO', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 13', capacidad: 128, bateria: 79, color: 'PINK', sucursal: 'DEPO', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 13', capacidad: 128, bateria: 80, color: 'PINK', sucursal: 'DEPO', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 13', capacidad: 128, bateria: 80, color: 'PINK', sucursal: 'DEPO', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 13', capacidad: 128, bateria: 81, color: 'PINK', sucursal: 'DEPO', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 13', capacidad: 128, bateria: 83, color: 'PINK', sucursal: 'DEPO', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 13', capacidad: 128, bateria: 85, color: 'PINK', sucursal: 'DEPO', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 13', capacidad: 128, bateria: 87, color: 'BLACK', sucursal: 'DEPO', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 13', capacidad: 128, bateria: 87, color: 'BLACK', sucursal: 'DEPO', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 13 Pro Max', capacidad: 128, bateria: 88, color: 'Black', sucursal: 'DEPO', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 13 Pro Max', capacidad: 128, bateria: 100, color: 'Black', sucursal: 'DEPO', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 13 Pro Max', capacidad: 128, bateria: 100, color: 'BLUE', sucursal: 'DEPO', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 14', capacidad: 128, bateria: 100, color: 'BLUE', sucursal: 'DEPO', estado: 'Reservado', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 14 Pro', capacidad: 128, bateria: 80, color: 'BLACK', sucursal: 'DEPO', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 14 Pro', capacidad: 128, bateria: 81, color: 'BLACK', sucursal: 'DEPO', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 14 Pro', capacidad: 128, bateria: 100, color: 'Purple', sucursal: 'DEPO', estado: 'Reservado', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 14 Pro', capacidad: 128, bateria: 86, color: 'Black', sucursal: 'DEPO', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 14 Pro', capacidad: 128, bateria: 100, color: 'BLACK', sucursal: 'DEPO', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 14 Pro', capacidad: 256, bateria: 76, color: 'BLACK', sucursal: 'DEPO', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 14 Pro Max', capacidad: 128, bateria: 87, color: 'PURPLE', sucursal: 'DEPO', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 14 Pro Max', capacidad: 128, bateria: 87, color: 'NEGRO', sucursal: 'DEPO', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 14 Pro Max', capacidad: 128, bateria: 94, color: 'NEGRO', sucursal: 'DEPO', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 14 Pro Max', capacidad: 128, bateria: 80, color: 'SILVER', sucursal: 'DEPO', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 14 Pro Max', capacidad: 1024, bateria: 85, color: 'SILVER', sucursal: 'DEPO', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 15 Pro', capacidad: 128, bateria: 86, color: 'NEGRO', sucursal: 'DEPO', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 15 Pro', capacidad: 128, bateria: 87, color: 'BLUE', sucursal: 'DEPO', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 15 Pro', capacidad: 128, bateria: 86, color: 'BLUE', sucursal: 'DEPO', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 15 Pro', capacidad: 128, bateria: 87, color: 'NATURAL', sucursal: 'DEPO', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 15 Pro', capacidad: 256, bateria: 85, color: 'NATURAL', sucursal: 'DEPO', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 15 Pro', capacidad: 128, bateria: 87, color: 'BLUE', sucursal: 'DEPO', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 15 Pro', capacidad: 128, bateria: 87, color: 'BLUE', sucursal: 'DEPO', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 15 Pro', capacidad: 128, bateria: 87, color: 'BLUE', sucursal: 'DEPO', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 15 Pro', capacidad: 128, bateria: 89, color: 'BLUE', sucursal: 'DEPO', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 15 Pro', capacidad: 128, bateria: 90, color: 'BLUE', sucursal: 'DEPO', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 15', capacidad: 128, bateria: 84, color: 'GREEN', sucursal: 'DEPO', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 15', capacidad: 128, bateria: 90, color: 'BLACK', sucursal: 'DEPO', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 17', capacidad: 256, bateria: 100, color: 'Silver', sucursal: 'DEPO', estado: 'En Stock', observaciones: 'Sellado' },
  { modelo: 'iPhone 16 Pro', capacidad: 256, bateria: 90, color: 'BLACK', sucursal: 'DEPO', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 14', capacidad: 128, bateria: 100, color: 'Midnight', sucursal: 'DEPO', estado: 'En Stock', observaciones: 'Sellado' },
  { modelo: 'iPhone 17 Pro Max', capacidad: 256, bateria: 100, color: 'SILVER', sucursal: 'DEPO', estado: 'En Stock', observaciones: 'Sellado' },
  { modelo: 'iPhone 17 Pro Max', capacidad: 256, bateria: 100, color: 'Cosmic Orange', sucursal: 'DEPO', estado: 'En Stock', observaciones: 'Sellado' },
  { modelo: 'iPhone 14', capacidad: 128, bateria: 100, color: 'Midnight', sucursal: 'DINO', estado: 'En Stock', observaciones: 'Sellado' },
  { modelo: 'iPhone 14', capacidad: 128, bateria: 100, color: 'Midnight', sucursal: 'DINO', estado: 'En Stock', observaciones: 'Sellado' },
  { modelo: 'iPhone 17 Pro Max', capacidad: 256, bateria: 100, color: 'Cosmic Orange', sucursal: 'DINO', estado: 'En Stock', observaciones: 'Sellado' },
  { modelo: 'iPhone 17 Pro Max', capacidad: 256, bateria: 100, color: 'SILVER', sucursal: 'DINO', estado: 'En Stock', observaciones: 'Sellado' },
  { modelo: 'iPhone 15', capacidad: 128, bateria: 100, color: 'BLUE', sucursal: 'DINO', estado: 'En Stock', observaciones: 'Sellado' },
  { modelo: 'iPhone 16', capacidad: 128, bateria: 100, color: 'Silver', sucursal: 'DINO', estado: 'En Stock', observaciones: 'Sellado' },
  { modelo: 'iPhone 16', capacidad: 128, bateria: 100, color: 'Silver', sucursal: 'DINO', estado: 'En Stock', observaciones: 'Sellado' },
  { modelo: 'iPhone 14 Pro', capacidad: 128, bateria: 100, color: 'PURPURA', sucursal: 'DINO', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 14 Pro', capacidad: 128, bateria: 100, color: 'BLACK', sucursal: 'DINO', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 14 Pro', capacidad: 128, bateria: 100, color: 'BLACK', sucursal: 'DINO', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 17 pro', capacidad: 256, bateria: 100, color: 'DeepBlue', sucursal: 'DINO', estado: 'En Stock', observaciones: 'Sellado' },
  { modelo: 'iPhone 15', capacidad: 128, bateria: 87, color: 'Pink', sucursal: 'NUEVO CENTRO', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 16 Pro', capacidad: 128, bateria: 91, color: 'Desert', sucursal: 'NUEVO CENTRO', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 14', capacidad: 128, bateria: 100, color: 'Midnight', sucursal: 'NUEVO CENTRO', estado: 'En Stock', observaciones: 'Sellado' },
  { modelo: 'iPhone 14', capacidad: 128, bateria: 100, color: 'Midnight', sucursal: 'NUEVO CENTRO', estado: 'En Stock', observaciones: 'Sellado' },
  { modelo: 'iPhone 17 Pro Max', capacidad: 256, bateria: 100, color: 'Cosmic Orange', sucursal: 'NUEVO CENTRO', estado: 'En Stock', observaciones: 'Sellado' },
  { modelo: 'iPhone 17 Pro Max', capacidad: 256, bateria: 100, color: 'SILVER', sucursal: 'NUEVO CENTRO', estado: 'En Stock', observaciones: 'Sellado' },
  { modelo: 'iPhone 17 Pro Max', capacidad: 256, bateria: 100, color: 'BLUE', sucursal: 'NUEVO CENTRO', estado: 'En Stock', observaciones: 'Sellado' },
  { modelo: 'iPhone 15', capacidad: 128, bateria: 100, color: 'BLUE', sucursal: 'NUEVO CENTRO', estado: 'En Stock', observaciones: 'Sellado' },
  { modelo: 'iPhone 16', capacidad: 128, bateria: 100, color: 'Silver', sucursal: 'NUEVO CENTRO', estado: 'En Stock', observaciones: 'Sellado' },
  { modelo: 'iPhone 16', capacidad: 128, bateria: 100, color: 'Silver', sucursal: 'NUEVO CENTRO', estado: 'En Stock', observaciones: 'Sellado' },
  { modelo: 'iPhone 14 Pro', capacidad: 128, bateria: 100, color: 'PURPURA', sucursal: 'NUEVO CENTRO', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 14 Pro', capacidad: 128, bateria: 100, color: 'BLACK', sucursal: 'NUEVO CENTRO', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 14 Pro', capacidad: 128, bateria: 100, color: 'BLACK', sucursal: 'NUEVO CENTRO', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 17', capacidad: 256, bateria: 100, color: 'Negro ', sucursal: 'NUEVO CENTRO', estado: 'En Stock', observaciones: 'Sellado' },
  { modelo: 'iPhone 17 pro', capacidad: 512, bateria: 100, color: 'silver', sucursal: 'NUEVO CENTRO', estado: 'En Stock', observaciones: 'Sellado' },
  { modelo: 'iPhone 17 Pro Max', capacidad: 512, bateria: 100, color: 'Cosmic Orange', sucursal: 'NUEVO CENTRO', estado: 'En Stock', observaciones: 'Sellado' },
  { modelo: 'iPhone 13', capacidad: 128, bateria: 85, color: 'PINK', sucursal: 'OLMOS', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 13', capacidad: 128, bateria: 85, color: 'PINK', sucursal: 'OLMOS', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 14', capacidad: 128, bateria: 86, color: 'Purple', sucursal: 'OLMOS', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 14 Pro Max', capacidad: 128, bateria: 87, color: 'PURPLE', sucursal: 'OLMOS', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 14 Pro Max', capacidad: 128, bateria: 99, color: 'PURPLE', sucursal: 'OLMOS', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 14 Pro Max', capacidad: 128, bateria: 100, color: 'PURPLE', sucursal: 'OLMOS', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 15 Pro', capacidad: 128, bateria: 86, color: 'BLUE', sucursal: 'OLMOS', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 15 Pro', capacidad: 128, bateria: 86, color: 'NEGRO', sucursal: 'OLMOS', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 14', capacidad: 128, bateria: 100, color: 'Midnight', sucursal: 'OLMOS', estado: 'En Stock', observaciones: 'Sellado' },
  { modelo: 'iPhone 17 Pro Max', capacidad: 256, bateria: 100, color: 'Cosmic Orange', sucursal: 'OLMOS', estado: 'En Stock', observaciones: 'Sellado' },
  { modelo: 'iPhone 17 Pro Max', capacidad: 256, bateria: 100, color: 'Cosmic Orange', sucursal: 'OLMOS', estado: 'En Stock', observaciones: 'Sellado' },
  { modelo: 'iPhone 16', capacidad: 128, bateria: 100, color: 'Silver', sucursal: 'OLMOS', estado: 'En Stock', observaciones: 'Sellado' },
  { modelo: 'iPhone 14 Pro', capacidad: 128, bateria: 100, color: 'BLACK', sucursal: 'OLMOS', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 14 Pro', capacidad: 128, bateria: 84, color: 'BLACK', sucursal: 'OLMOS', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 14 Pro', capacidad: 128, bateria: 84, color: 'Negro', sucursal: 'OLMOS', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 14 Pro', capacidad: 128, bateria: 100, color: 'PURPURA', sucursal: 'OLMOS', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 14 Pro', capacidad: 128, bateria: 100, color: 'BLACK', sucursal: 'OLMOS', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 17 pro', capacidad: 256, bateria: 100, color: 'DeepBlue', sucursal: 'OLMOS', estado: 'En Stock', observaciones: 'Sellado' },
  { modelo: 'iPhone 17 pro', capacidad: 256, bateria: 100, color: 'cosmic Orange', sucursal: 'OLMOS', estado: 'En Stock', observaciones: 'Sellado' },
  { modelo: 'iPhone 13 Pro', capacidad: 128, bateria: 100, color: 'GOLD', sucursal: 'SERVICIO TECNICO', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 12 Pro', capacidad: 128, bateria: 100, color: 'Blue', sucursal: 'SERVICIO TECNICO', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 13', capacidad: 128, bateria: 100, color: 'BLACK', sucursal: 'SERVICIO TECNICO', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 13', capacidad: 128, bateria: 70, color: 'PINK', sucursal: 'SERVICIO TECNICO', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 13', capacidad: 128, bateria: 75, color: 'PINK', sucursal: 'SERVICIO TECNICO', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 13', capacidad: 128, bateria: 76, color: 'PINK', sucursal: 'SERVICIO TECNICO', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 13', capacidad: 128, bateria: 76, color: 'PINK', sucursal: 'SERVICIO TECNICO', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 13', capacidad: 128, bateria: 80, color: 'PINK', sucursal: 'SERVICIO TECNICO', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 13', capacidad: 128, bateria: 72, color: 'PINK', sucursal: 'SERVICIO TECNICO', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 14 Pro Max', capacidad: 128, bateria: 83, color: 'PURPLE', sucursal: 'SERVICIO TECNICO', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 14 Pro Max', capacidad: 128, bateria: 84, color: 'PURPLE', sucursal: 'SERVICIO TECNICO', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 14 Pro Max', capacidad: 128, bateria: 85, color: 'PURPLE', sucursal: 'SERVICIO TECNICO', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 15 Pro', capacidad: 128, bateria: 79, color: 'SILVER', sucursal: 'SERVICIO TECNICO', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 15 Pro', capacidad: 128, bateria: 81, color: 'blue', sucursal: 'SERVICIO TECNICO', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 15 Pro', capacidad: 128, bateria: 85, color: 'BLUE', sucursal: 'SERVICIO TECNICO', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 15 Pro', capacidad: 128, bateria: 86, color: 'BLUE', sucursal: 'SERVICIO TECNICO', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 14 Pro Max', capacidad: 128, bateria: 83, color: 'PURPLE', sucursal: 'SERVICIO TECNICO', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 13', capacidad: 128, bateria: 66, color: 'PINK', sucursal: 'SERVICIO TECNICO', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 13', capacidad: 128, bateria: 81, color: 'PINK', sucursal: 'SERVICIO TECNICO', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 13', capacidad: 128, bateria: 100, color: 'PINK', sucursal: 'SERVICIO TECNICO', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
  { modelo: 'iPhone 13', capacidad: 128, bateria: 72, color: 'PINK', sucursal: 'SERVICIO TECNICO', estado: 'En Stock', observaciones: 'Semi-Nuevo' },
];
