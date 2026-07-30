// ============================================================
// DATOS DEL COTIZADOR (harness local, sin Google Apps Script).
//
// Esto es lo que despues se va a leer de la Google Sheet real. Por ahora
// es JS editable a mano para poder probar y ajustar rapido en el navegador.
// Lo marcado como MOCK es un placeholder inventado para poder probar la
// pantalla — hay que reemplazarlo por datos reales antes de pasar esto a
// produccion.
//
// La tabla de "Shopping" SI es real: sale de "Lista precios.xlsx" que
// pasaste (precios de shopping, en USD, Semi Nuevos / Sellado).
// ============================================================

window.COTIZADOR_DATA = {

  // Cotizacion del dolar. Valor inicial (MOCK) que se pisa apenas carga la
  // pagina: actualizarDolar() en app.js pide netlify/functions/dolar.js,
  // que scrapea infodolar.com server-side y refresca esto cada 5 min.
  dolar: { DolarCompra: 1300, DolarVenta: 1350 }, // MOCK, se pisa al cargar

  // Quedaron 2 sucursales (antes habia varias mas, se descartaron).
  sucursales: ['Shopping', 'Independencia'],

  // Que sucursales usan la tabla "shopping" (Lista precios.xlsx) en vez de
  // la tabla estandar. Ajustar esta lista si hay mas de un shopping.
  sucursalesShopping: ['Shopping'],

  // Los "depositos" que aparecen en Stock.xlsx (OLMOS, DINO, NUEVO CENTRO,
  // DEPO, SERVICIO TECNICO) son ubicaciones internas del sistema viejo, no
  // las 2 sucursales de venta nuevas. El usuario confirmo que OLMOS, DINO y
  // NUEVO CENTRO pertenecen a "Shopping"; Independencia es su propio
  // deposito. DEPO y SERVICIO TECNICO no fueron asignados a ninguna de las
  // 2 -- quedan sueltos hasta que el usuario diga donde van.
  depositoPorSucursal: {
    'Shopping': ['OLMOS', 'DINO', 'NUEVO CENTRO'],
    'Independencia': ['INDEPENDENCIA']
  },

  // --------------------------------------------------------------
  // PRECIOS DE EQUIPOS (venta), por sucursal.
  // Formato: un objeto por modelo, con precio de venta en USD por
  // capacidad y condicion (seminuevo/sellado). "null" = no disponible en
  // esa condicion/capacidad.
  // --------------------------------------------------------------

  equiposPorSucursal: {

    // REAL: extraido de "Lista precios.xlsx" (precios de Shopping).
    'Shopping': [
      { modelo: 'iPhone 13',           capacidades: { '128Gb': { seminuevo: 520,  sellado: null }, '256Gb': { seminuevo: 620,  sellado: null }, '512Gb': { seminuevo: 670,  sellado: null }, '1Tb': { seminuevo: 720,  sellado: null } } },
      { modelo: 'iPhone 13 Pro',       capacidades: { '128Gb': { seminuevo: 600,  sellado: null }, '256Gb': { seminuevo: 700,  sellado: null }, '512Gb': { seminuevo: 750,  sellado: null }, '1Tb': { seminuevo: 800,  sellado: null } } },
      { modelo: 'iPhone 13 Pro Max',   capacidades: { '128Gb': { seminuevo: 700,  sellado: null }, '256Gb': { seminuevo: 800,  sellado: null }, '512Gb': { seminuevo: 850,  sellado: null }, '1Tb': { seminuevo: 900,  sellado: null } } },
      { modelo: 'iPhone 14',           capacidades: { '128Gb': { seminuevo: 590,  sellado: null }, '256Gb': { seminuevo: 690,  sellado: null }, '512Gb': { seminuevo: 740,  sellado: null }, '1Tb': { seminuevo: 790,  sellado: null } } },
      { modelo: 'iPhone 14 Pro',       capacidades: { '128Gb': { seminuevo: 700,  sellado: null }, '256Gb': { seminuevo: 800,  sellado: null }, '512Gb': { seminuevo: 850,  sellado: null }, '1Tb': { seminuevo: 900,  sellado: null } } },
      { modelo: 'iPhone 14 Pro Max',   capacidades: { '128Gb': { seminuevo: 870,  sellado: null }, '256Gb': { seminuevo: 970,  sellado: null }, '512Gb': { seminuevo: 1020, sellado: null }, '1Tb': { seminuevo: 1070, sellado: null } } },
      { modelo: 'iPhone 15',           capacidades: { '128Gb': { seminuevo: 700,  sellado: 900  }, '256Gb': { seminuevo: 800,  sellado: null }, '512Gb': { seminuevo: 850,  sellado: null }, '1Tb': { seminuevo: 900,  sellado: null } } },
      { modelo: 'iPhone 15 Pro',       capacidades: { '128Gb': { seminuevo: 900,  sellado: null }, '256Gb': { seminuevo: 1000, sellado: null }, '512Gb': { seminuevo: 1050, sellado: null }, '1Tb': { seminuevo: 1100, sellado: null } } },
      { modelo: 'iPhone 15 Pro Max',   capacidades: { '128Gb': { seminuevo: 1000, sellado: null }, '256Gb': { seminuevo: 1100, sellado: null }, '512Gb': { seminuevo: 1150, sellado: null }, '1Tb': { seminuevo: 1200, sellado: null } } },
      { modelo: 'iPhone 16',           capacidades: { '128Gb': { seminuevo: 915,  sellado: 1050 }, '256Gb': { seminuevo: 1015, sellado: null }, '512Gb': { seminuevo: 1065, sellado: null }, '1Tb': { seminuevo: 1115, sellado: null } } },
      { modelo: 'iPhone 16E',          capacidades: { '128Gb': { seminuevo: 700,  sellado: null }, '256Gb': { seminuevo: 800,  sellado: null }, '512Gb': { seminuevo: 850,  sellado: null }, '1Tb': { seminuevo: 900,  sellado: null } } },
      { modelo: 'iPhone 16 Pro',       capacidades: { '128Gb': { seminuevo: 1050, sellado: null }, '256Gb': { seminuevo: 1150, sellado: null }, '512Gb': { seminuevo: 1200, sellado: null }, '1Tb': { seminuevo: 1250, sellado: null } } },
      { modelo: 'iPhone 16 Pro Max',   capacidades: { '128Gb': { seminuevo: 1150, sellado: null }, '256Gb': { seminuevo: 1250, sellado: null }, '512Gb': { seminuevo: 1300, sellado: null }, '1Tb': { seminuevo: 1350, sellado: null } } },
      { modelo: 'iPhone 17Air',        capacidades: { '128Gb': { seminuevo: null, sellado: null }, '256Gb': { seminuevo: null, sellado: 1200 }, '512Gb': { seminuevo: null, sellado: null }, '1Tb': { seminuevo: null, sellado: null } } },
      { modelo: 'iPhone 17',           capacidades: { '128Gb': { seminuevo: null,  sellado: null }, '256Gb': { seminuevo: 1150, sellado: 1250 }, '512Gb': { seminuevo: 1300, sellado: 1350 }, '1Tb': { seminuevo: 1350, sellado: 1550 } } },
      { modelo: 'iPhone 17 Pro',       capacidades: { '128Gb': { seminuevo: null,  sellado: null }, '256Gb': { seminuevo: 1646, sellado: 1656 }, '512Gb': { seminuevo: 1796, sellado: 1756 }, '1Tb': { seminuevo: 1846, sellado: 1956 } } },
      { modelo: 'iPhone 17 Pro Max',   capacidades: { '128Gb': { seminuevo: null,  sellado: null }, '256Gb': { seminuevo: 1800, sellado: 1800 }, '512Gb': { seminuevo: 1950, sellado: 1900 }, '1Tb': { seminuevo: 2000, sellado: 2100 } } }
    ],

    // Independencia: lista real pasada por el usuario (excel con 2 tablas:
    // "Sellados" y "Semi Nuevos"). A diferencia de Shopping, los Semi Nuevos
    // de Independencia tienen VARIOS precios segun el estado de bateria del
    // equipo (por eso "seminuevoTiers": un array de { etiqueta, precio } en
    // vez de un solo numero en "seminuevo"). El usuario confirmo que un
    // porcentaje negativo en el excel original (ej. -0.8, -1.0) significa
    // "menor a ese %" (bateria mas gastada que ese umbral), y que los
    // precios estan en USD igual que el resto de la lista.
    // "Todas las baterias" = un unico precio sin importar el % de bateria
    // (asi decia el excel para 16/16 Pro/16 Pro Max).
    // Los modelos 17/17 Pro/17 Pro Max/17 Air solo vinieron con precio de
    // Sellado (el excel no trajo Semi Nuevo para esos todavia).
    'Independencia': [
      { modelo: 'iPhone 11',         capacidades: {
        '64Gb':  { sellado: null, seminuevoTiers: [{ etiqueta: '100%', precio: 200 }] },
        '128Gb': { sellado: null, seminuevoTiers: [{ etiqueta: '100%', precio: 220 }] }
      } },
      { modelo: 'iPhone 11 Pro',     capacidades: {
        '64Gb':  { sellado: null, seminuevoTiers: [{ etiqueta: '100%', precio: 250 }] },
        '256Gb': { sellado: null, seminuevoTiers: [{ etiqueta: '100%', precio: 280 }] }
      } },
      { modelo: 'iPhone 11 Pro Max', capacidades: {
        '64Gb':  { sellado: null, seminuevoTiers: [{ etiqueta: '100%', precio: 280 }] },
        '256Gb': { sellado: null, seminuevoTiers: [{ etiqueta: '100%', precio: 300 }] }
      } },
      { modelo: 'iPhone 12 mini',    capacidades: {
        '64Gb':  { sellado: null, seminuevoTiers: [{ etiqueta: '100%', precio: 200 }] }
      } },
      { modelo: 'iPhone 12',         capacidades: {
        '64Gb':  { sellado: null, seminuevoTiers: [{ etiqueta: '100%', precio: 250 }] },
        '128Gb': { sellado: null, seminuevoTiers: [{ etiqueta: '100%', precio: 280 }] }
      } },
      { modelo: 'iPhone 12 Pro',     capacidades: {
        '128Gb': { sellado: null, seminuevoTiers: [{ etiqueta: '100%', precio: 300 }] }
      } },
      { modelo: 'iPhone 12 Pro Max', capacidades: {
        '128Gb': { sellado: null, seminuevoTiers: [{ etiqueta: '100%', precio: 400 }] }
      } },
      { modelo: 'iPhone 13',         capacidades: {
        '128Gb': { sellado: null, seminuevoTiers: [
          { etiqueta: 'Menor a 80%', precio: 300 },
          { etiqueta: '80% a 90%',   precio: 330 },
          { etiqueta: '90% a 98%',   precio: 350 },
          { etiqueta: '100%',        precio: 380 }
        ] }
      } },
      { modelo: 'iPhone 13 Pro',     capacidades: {
        '128Gb': { sellado: null, seminuevoTiers: [{ etiqueta: '100%', precio: 450 }] },
        '256Gb': { sellado: null, seminuevoTiers: [{ etiqueta: '100%', precio: 550 }] }
      } },
      { modelo: 'iPhone 13 Pro Max', capacidades: {
        '128Gb': { sellado: null, seminuevoTiers: [{ etiqueta: '100%', precio: 600 }] },
        '256Gb': { sellado: null, seminuevoTiers: [{ etiqueta: '100%', precio: 650 }] }
      } },
      { modelo: 'iPhone 14',         capacidades: {
        '128Gb': { sellado: 650, seminuevoTiers: [
          { etiqueta: 'Menor a 100%', precio: 400 },
          { etiqueta: '100%',         precio: 450 }
        ] }
      } },
      { modelo: 'iPhone 14 Pro',     capacidades: {
        '128Gb': { sellado: null, seminuevoTiers: [
          { etiqueta: 'Menor a 80%', precio: 500 },
          { etiqueta: '80% a 90%',   precio: 550 },
          { etiqueta: '90% a 100%',  precio: 580 }
        ] }
      } },
      { modelo: 'iPhone 14 Pro Max', capacidades: {
        '128Gb': { sellado: null, seminuevoTiers: [{ etiqueta: '90% a 100%', precio: 650 }] },
        '256Gb': { sellado: null, seminuevoTiers: [{ etiqueta: '90% a 100%', precio: 680 }] }
      } },
      { modelo: 'iPhone 15',         capacidades: {
        '128Gb': { sellado: 850, seminuevoTiers: [
          { etiqueta: 'Menor a 100%', precio: 500 },
          { etiqueta: '100%',         precio: 550 }
        ] }
      } },
      { modelo: 'iPhone 15 Pro',     capacidades: {
        '128Gb': { sellado: null, seminuevoTiers: [
          { etiqueta: 'Menor a 100%', precio: 600 },
          { etiqueta: '100%',         precio: 650 }
        ] },
        '256Gb': { sellado: null, seminuevoTiers: [{ etiqueta: '100%', precio: 710 }] }
      } },
      { modelo: 'iPhone 15 Pro Max', capacidades: {
        '256Gb': { sellado: null, seminuevoTiers: [{ etiqueta: '100%', precio: 800 }] },
        '512Gb': { sellado: null, seminuevoTiers: [{ etiqueta: '100%', precio: 850 }] }
      } },
      { modelo: 'iPhone 16',         capacidades: {
        '128Gb': { sellado: 950, seminuevoTiers: [{ etiqueta: 'Todas las baterias', precio: 725 }] }
      } },
      { modelo: 'iPhone 16 Pro',     capacidades: {
        '128Gb': { sellado: null, seminuevoTiers: [{ etiqueta: 'Todas las baterias', precio: 850 }] }
      } },
      { modelo: 'iPhone 16 Pro Max', capacidades: {
        '256Gb': { sellado: null, seminuevoTiers: [{ etiqueta: 'Todas las baterias', precio: 975 }] }
      } },
      { modelo: 'iPhone 17',         capacidades: { '256Gb': { sellado: 1060, seminuevoTiers: [] } } },
      { modelo: 'iPhone 17 Pro',     capacidades: { '256Gb': { sellado: 1260, seminuevoTiers: [] } } },
      { modelo: 'iPhone 17 Pro Max', capacidades: { '256Gb': { sellado: 1360, seminuevoTiers: [] } } },
      { modelo: 'iPhone 17Air',      capacidades: { '256Gb': { sellado: 1130, seminuevoTiers: [] } } }
    ]
  },

  // --------------------------------------------------------------
  // TRADE IN: valor base que SIEMPRE se resta al hacer un plan canje de ese
  // modelo (independiente del estado). Si ademas hay fallas marcadas en el
  // checklist, el descuento por reparacion (80% del precio, ver
  // evaluarChecklistTradeIn en app.js) se SUMA arriba de este base -- no lo
  // reemplaza. En USD, convertido a ARS con DolarVenta igual que el resto.
  //
  // REAL: valores que paso el usuario. iPhone 13 Mini: $150. Familia iPhone
  // 17 = familia iPhone 16 equivalente + USD 100 (17/17Air sobre la base de
  // 16/16 Plus, 17 Pro sobre 16 Pro, 17 Pro Max sobre 16 Pro Max).
  //
  // Independencia tiene su PROPIA tabla de trade-in (distinta a Shopping),
  // pasada por el usuario. No incluye iPhone 17 ni el resto de los modelos
  // que no aparecen abajo -- si falta uno es porque el usuario no paso ese
  // valor todavia.
  baseTradeInUsdPorSucursal: {
    'Shopping': {
      'iPhone 11': 100, 'iPhone 11 Pro': 100, 'iPhone 11 Pro Max': 100,
      'iPhone 12': 100, 'iPhone 12 Mini': 100, 'iPhone 12 Pro': 100, 'iPhone 12 Pro Max': 100,
      'iPhone 13': 250,
      'iPhone 13 Mini': 150,
      'iPhone 13 Pro': 350,
      'iPhone 13 Pro Max': 500,
      'iPhone 14': 360, 'iPhone 14 Plus': 360,
      'iPhone 14 Pro': 420,
      'iPhone 14 Pro Max': 620,
      'iPhone 15': 450,
      'iPhone 15 Plus': 450,
      'iPhone 15 Pro': 580,
      'iPhone 15 Pro Max': 720,
      'iPhone 16': 650, 'iPhone 16 Plus': 650,
      'iPhone 16E': 400,
      'iPhone 16 Pro': 750,
      'iPhone 16 Pro Max': 900,
      'iPhone 17': 750, 'iPhone 17Air': 750,
      'iPhone 17 Pro': 850,
      'iPhone 17 Pro Max': 1000
    },
    'Independencia': {
      'iPhone XR': 50,
      'iPhone 11': 100, 'iPhone 11 Pro': 100, 'iPhone 11 Pro Max': 150,
      'iPhone 12': 150, 'iPhone 12 Mini': 150, 'iPhone 12 Pro': 200, 'iPhone 12 Pro Max': 200,
      'iPhone 13': 220,
      'iPhone 13 Mini': 190,
      'iPhone 13 Pro': 320,
      'iPhone 13 Pro Max': 400,
      'iPhone 14': 300, 'iPhone 14 Plus': 300,
      'iPhone 14 Pro': 350,
      'iPhone 14 Pro Max': 520,
      'iPhone 15': 400,
      'iPhone 15 Plus': 450,
      'iPhone 15 Pro': 440,
      'iPhone 15 Pro Max': 650,
      'iPhone 16': 580, 'iPhone 16 Plus': 580,
      'iPhone 16E': 300,
      'iPhone 16 Pro': 700,
      'iPhone 16 Pro Max': 850
    }
  },

  // --------------------------------------------------------------
  // OTROS EQUIPOS SELLADOS (AirPods, Apple Watch, iPad, MacBook): apareacen
  // en Venta de equipos > Modelo, junto con los iPhone, pero NO en Compra
  // (trade-in) ni en Reparacion, que siguen siendo solo celulares.
  //
  // REAL: precios en USD que paso el usuario. Mismo precio en todas las
  // sucursales (no vino diferenciado por shopping como los iPhone).
  //
  // Usan el mismo formato que "equiposPorSucursal" (modelo + capacidades),
  // solo que aca "capacidad" es en realidad la variante (tamano/color/specs)
  // y siempre es "sellado" (no hay seminuevo de estos productos).
  //
  // OJO — conflicto sin resolver: pasaste dos precios distintos para el
  // MacBook Air 15" M5 512GB/16GB (Plata/Medianoche/Azul Cielo): un primer
  // mensaje decia USD 1900, y la lista con emojis decia USD 1840 para
  // practicamente el mismo modelo (Silver/Midnight/Sky Blue). Usé el de la
  // lista con emojis (1840, mas especifica con cores/CPU/GPU) pero
  // convendria que confirmes cual es el correcto.
  //
  // Tambien: "Apple Watch Ultra 3 con GPS y Celular" no tenia precio en tu
  // mensaje, asi que no lo cargue. Y "MacBook Neo" lo pasaste con "$" en vez
  // de "USD" — asumi que tambien es USD (si es ARS, avisame y lo corrijo).
  otrosEquiposUniversales: [
    { modelo: 'AirPods 3ra Generacion',                         capacidades: { 'Unico': { seminuevo: null, sellado: 340 } } },
    { modelo: 'AirPods 4ta Generacion',                         capacidades: { 'Unico': { seminuevo: null, sellado: 355 } } },
    { modelo: 'AirPods 4ta Generacion (Cancelacion de Ruido)',  capacidades: { 'Unico': { seminuevo: null, sellado: 410 } } },
    { modelo: 'AirPods Pro 2da Generacion',                     capacidades: { 'Unico': { seminuevo: null, sellado: 420 } } },
    { modelo: 'AirPods Pro 3ra Generacion',                     capacidades: { 'Unico': { seminuevo: null, sellado: 510 } } },
    { modelo: 'AirPods Max',                                    capacidades: { 'Unico': { seminuevo: null, sellado: 780 } } },

    { modelo: 'Apple Watch SE 2da Gen (GPS)',        capacidades: { '40mm': { seminuevo: null, sellado: 450 }, '44mm': { seminuevo: null, sellado: 450 } } },
    { modelo: 'Apple Watch SE 3ra Gen (GPS)',        capacidades: { '40mm': { seminuevo: null, sellado: 550 }, '44mm': { seminuevo: null, sellado: 560 } } },
    { modelo: 'Apple Watch Serie 10 (GPS)',          capacidades: { '42mm': { seminuevo: null, sellado: 550 }, '46mm': { seminuevo: null, sellado: 600 } } },
    { modelo: 'Apple Watch Serie 10 (GPS + Celular)', capacidades: { '46mm': { seminuevo: null, sellado: 950 } } },
    { modelo: 'Apple Watch Serie 11 (GPS)',          capacidades: { '42mm': { seminuevo: null, sellado: 640 }, '46mm': { seminuevo: null, sellado: 660 } } },
    // Apple Watch Ultra 3 (GPS + Celular): SIN PRECIO, falta que lo pases.

    { modelo: 'iPad A16 (2025)',   capacidades: { '11" 128GB Azul/Rosa': { seminuevo: null, sellado: 665 }, '11" 256GB': { seminuevo: null, sellado: 760 } } },
    { modelo: 'iPad Air M3',       capacidades: { '11" 256GB Azul': { seminuevo: null, sellado: 1150 }, '13" 256GB Azul/Morado': { seminuevo: null, sellado: 1300 } } },
    { modelo: 'iPad Pro M4',       capacidades: { '11" 256GB': { seminuevo: null, sellado: 1355 } } },
    { modelo: 'iPad Pro M5',       capacidades: { '11" 256GB': { seminuevo: null, sellado: 1380 } } },

    { modelo: 'MacBook Air 13" M1',  capacidades: { '8CPU/7GPU 256GB 8GB Space Gray (teclado espanol)': { seminuevo: null, sellado: 1080 } } },
    { modelo: 'MacBook Air 13" M5',  capacidades: {
        '10CPU/8GPU 512GB 16GB Silver':   { seminuevo: null, sellado: 1550 },
        '10CPU/8GPU 512GB 16GB Midnight': { seminuevo: null, sellado: 1550 },
        '10CPU/8GPU 512GB 16GB Starlight':{ seminuevo: null, sellado: 1550 }
      } },
    { modelo: 'MacBook Air 15" M3',  capacidades: { '512GB 24GB RAM Plata': { seminuevo: null, sellado: 1760 } } },
    { modelo: 'MacBook Air 15" M5',  capacidades: {
        '512GB 16GB Silver':    { seminuevo: null, sellado: 1840 }, // ver nota de conflicto arriba (vs 1900)
        '512GB 16GB Starlight': { seminuevo: null, sellado: 1840 },
        '512GB 16GB Sky Blue':  { seminuevo: null, sellado: 1840 }
      } },

    { modelo: 'MacBook Pro 14" M5',      capacidades: {
        '10CPU/10GPU 1TB 24GB Space Black': { seminuevo: null, sellado: 2630 },
        '10CPU/10GPU 1TB 24GB Silver':      { seminuevo: null, sellado: 2630 }
      } },
    { modelo: 'MacBook Pro 14" M5 Pro',  capacidades: {
        '15CPU/16GPU 1TB 24GB Space Black': { seminuevo: null, sellado: 2880 },
        '15CPU/16GPU 1TB 24GB Silver':      { seminuevo: null, sellado: 2880 }
      } },

    { modelo: 'MacBook Neo', capacidades: {
        '256GB 8GB RAM': { seminuevo: null, sellado: 1300 },
        '512GB 8GB RAM': { seminuevo: null, sellado: 1500 }
      } }
  ],

  // --------------------------------------------------------------
  // REPARACIONES: precio por falla. MOCK (mismo precio para cualquier
  // modelo, para poder probar la pantalla). Reemplazar por precios reales
  // por modelo cuando esten disponibles.
  // --------------------------------------------------------------
  // REAL (con reservas -- ver aviso abajo): tabla de precios de reparacion
  // que pasaste (imagen), en USD, por modelo x tipo de falla. Se convierte a
  // ARS con DolarVenta al mostrarse, igual que los equipos.
  //
  // "null" = esa reparacion no se hace en ese modelo ("-", "No se repara" o
  // "aun no disponible" en la imagen original).
  //
  // *** AVISO IMPORTANTE ***
  // Esta tabla la transcribi a mano desde una captura de pantalla, no desde
  // un excel/csv (no me lo pasaste). Con 30 modelos x 12 columnas el riesgo
  // de error de tipeo es real, y son precios que se le cobran al cliente.
  // Marque con un comentario "REVISAR" las filas donde tuve mas dudas al
  // leer la imagen (iPhone 12 Mini, y las filas 16/16E/16 Plus/16 Pro/16 Pro
  // Max/17/17Air/17 Pro/17 Pro Max en la columna "Cambio bateria", que en la
  // imagen decia "aun no disponible" en vez de un precio). Te pido que las
  // repases contra tu fuente antes de usar esto para cotizar en serio.
  tiposFalla: [
    'Diagnostico', 'Placa', 'Camara frontal', 'Camara trasera', 'Modulo original',
    'Modulo premium y glass', 'Cambio bateria', 'Cambio tapa trasera', 'Cambio chasis',
    'Flex de carga', 'Flex varios', 'Face ID', 'Vidrio de camara'
  ],

  // Diagnostico es un servicio con precio fijo en ARS (no en USD, no varia
  // por modelo) -- a pedido del usuario.
  diagnosticoPrecioArs: 35000,

  reparacionesPorModelo: [
    { modelo: 'iPhone X',           precios: { 'Placa': 60,  'Camara frontal': 42,  'Camara trasera': 48,  'Modulo original': null, 'Modulo premium y glass': 60,  'Cambio bateria': 29, 'Cambio tapa trasera': 48, 'Cambio chasis': null, 'Flex de carga': 26, 'Flex varios': 24, 'Face ID': 84,  'Vidrio de camara': 30 } },
    { modelo: 'iPhone XS',          precios: { 'Placa': 60,  'Camara frontal': 44,  'Camara trasera': 54,  'Modulo original': null, 'Modulo premium y glass': 60,  'Cambio bateria': 38, 'Cambio tapa trasera': 48, 'Cambio chasis': null, 'Flex de carga': 26, 'Flex varios': 24, 'Face ID': 84,  'Vidrio de camara': 30 } },
    { modelo: 'iPhone XS Max',      precios: { 'Placa': 60,  'Camara frontal': 47,  'Camara trasera': 54,  'Modulo original': null, 'Modulo premium y glass': 66,  'Cambio bateria': 41, 'Cambio tapa trasera': 48, 'Cambio chasis': null, 'Flex de carga': 26, 'Flex varios': 24, 'Face ID': 84,  'Vidrio de camara': 30 } },
    { modelo: 'iPhone XR',          precios: { 'Placa': 60,  'Camara frontal': 47,  'Camara trasera': 42,  'Modulo original': null, 'Modulo premium y glass': 59,  'Cambio bateria': 42, 'Cambio tapa trasera': 48, 'Cambio chasis': null, 'Flex de carga': 34, 'Flex varios': 30, 'Face ID': 84,  'Vidrio de camara': 36 } },
    { modelo: 'iPhone SE 2020',     precios: { 'Placa': null, 'Camara frontal': 24,  'Camara trasera': 30,  'Modulo original': 96,   'Modulo premium y glass': 67,  'Cambio bateria': 36, 'Cambio tapa trasera': 42, 'Cambio chasis': null, 'Flex de carga': 34, 'Flex varios': 30, 'Face ID': null, 'Vidrio de camara': 36 } },
    { modelo: 'iPhone 11',          precios: { 'Placa': 144, 'Camara frontal': 54,  'Camara trasera': 58,  'Modulo original': 102,  'Modulo premium y glass': 71,  'Cambio bateria': 55, 'Cambio tapa trasera': 60, 'Cambio chasis': 72,   'Flex de carga': 42, 'Flex varios': 36, 'Face ID': 108, 'Vidrio de camara': 42 } },
    { modelo: 'iPhone 11 Pro',      precios: { 'Placa': 150, 'Camara frontal': 60,  'Camara trasera': 78,  'Modulo original': 114,  'Modulo premium y glass': 80,  'Cambio bateria': 60, 'Cambio tapa trasera': 60, 'Cambio chasis': 72,   'Flex de carga': 84, 'Flex varios': 54, 'Face ID': 108, 'Vidrio de camara': 42 } },
    { modelo: 'iPhone 11 Pro Max',  precios: { 'Placa': 156, 'Camara frontal': 66,  'Camara trasera': 80,  'Modulo original': 132,  'Modulo premium y glass': 92,  'Cambio bateria': 66, 'Cambio tapa trasera': 60, 'Cambio chasis': 72,   'Flex de carga': 90, 'Flex varios': 54, 'Face ID': 108, 'Vidrio de camara': 42 } },
    { modelo: 'iPhone 12',          precios: { 'Placa': 180, 'Camara frontal': 72,  'Camara trasera': 72,  'Modulo original': 132,  'Modulo premium y glass': 92,  'Cambio bateria': 66, 'Cambio tapa trasera': 72, 'Cambio chasis': 90,   'Flex de carga': 90, 'Flex varios': 54, 'Face ID': 120, 'Vidrio de camara': 46 } },
    // REVISAR: fila con mas dudas de toda la tabla, la imagen tenia un valor de mas en esta fila.
    { modelo: 'iPhone 12 Mini',     precios: { 'Placa': 180, 'Camara frontal': 72,  'Camara trasera': 72,  'Modulo original': 132,  'Modulo premium y glass': 92,  'Cambio bateria': 66, 'Cambio tapa trasera': 72, 'Cambio chasis': 90,   'Flex de carga': 90, 'Flex varios': 54, 'Face ID': 114, 'Vidrio de camara': 46 } },
    { modelo: 'iPhone 12 Pro',      precios: { 'Placa': 204, 'Camara frontal': 78,  'Camara trasera': 162, 'Modulo original': 162,  'Modulo premium y glass': 113, 'Cambio bateria': 72, 'Cambio tapa trasera': 72, 'Cambio chasis': 90,   'Flex de carga': 94, 'Flex varios': 58, 'Face ID': 120, 'Vidrio de camara': 46 } },
    { modelo: 'iPhone 12 Pro Max',  precios: { 'Placa': 210, 'Camara frontal': 80,  'Camara trasera': 144, 'Modulo original': 180,  'Modulo premium y glass': 126, 'Cambio bateria': 80, 'Cambio tapa trasera': 72, 'Cambio chasis': 90,   'Flex de carga': 98, 'Flex varios': 60, 'Face ID': 132, 'Vidrio de camara': 50 } },
    { modelo: 'iPhone 13',          precios: { 'Placa': 228, 'Camara frontal': 78,  'Camara trasera': 72,  'Modulo original': 180,  'Modulo premium y glass': 126, 'Cambio bateria': 84, 'Cambio tapa trasera': 84, 'Cambio chasis': 108,  'Flex de carga': 96, 'Flex varios': 60, 'Face ID': 156, 'Vidrio de camara': 50 } },
    { modelo: 'iPhone 13 Mini',     precios: { 'Placa': 228, 'Camara frontal': 78,  'Camara trasera': 72,  'Modulo original': 180,  'Modulo premium y glass': 126, 'Cambio bateria': 84, 'Cambio tapa trasera': 78, 'Cambio chasis': 84,   'Flex de carga': 108, 'Flex varios': 96, 'Face ID': 60,  'Vidrio de camara': 156 } },
    { modelo: 'iPhone 13 Pro',      precios: { 'Placa': 288, 'Camara frontal': 90,  'Camara trasera': 180, 'Modulo original': 264,  'Modulo premium y glass': 185, 'Cambio bateria': 90, 'Cambio tapa trasera': 84, 'Cambio chasis': 144,  'Flex de carga': 108, 'Flex varios': 60, 'Face ID': 180, 'Vidrio de camara': 54 } },
    { modelo: 'iPhone 13 Pro Max',  precios: { 'Placa': 300, 'Camara frontal': 94,  'Camara trasera': 192, 'Modulo original': 312,  'Modulo premium y glass': 218, 'Cambio bateria': 96, 'Cambio tapa trasera': 84, 'Cambio chasis': 168,  'Flex de carga': 120, 'Flex varios': 60, 'Face ID': 198, 'Vidrio de camara': 58 } },
    { modelo: 'iPhone 14',          precios: { 'Placa': 216, 'Camara frontal': 102, 'Camara trasera': 120, 'Modulo original': 240,  'Modulo premium y glass': 168, 'Cambio bateria': 90, 'Cambio tapa trasera': 60, 'Cambio chasis': 144,  'Flex de carga': 96, 'Flex varios': 66, 'Face ID': 168, 'Vidrio de camara': 48 } },
    { modelo: 'iPhone 14 Plus',     precios: { 'Placa': 216, 'Camara frontal': 102, 'Camara trasera': 120, 'Modulo original': 240,  'Modulo premium y glass': 168, 'Cambio bateria': 90, 'Cambio tapa trasera': 60, 'Cambio chasis': 144,  'Flex de carga': 102, 'Flex varios': 66, 'Face ID': 168, 'Vidrio de camara': 48 } },
    { modelo: 'iPhone 14 Pro',      precios: { 'Placa': 312, 'Camara frontal': 114, 'Camara trasera': 192, 'Modulo original': 300,  'Modulo premium y glass': 210, 'Cambio bateria': 102, 'Cambio tapa trasera': 96, 'Cambio chasis': 168, 'Flex de carga': 126, 'Flex varios': 70, 'Face ID': 204, 'Vidrio de camara': 56 } },
    { modelo: 'iPhone 14 Pro Max',  precios: { 'Placa': 348, 'Camara frontal': 118, 'Camara trasera': 216, 'Modulo original': 396,  'Modulo premium y glass': 277, 'Cambio bateria': 114, 'Cambio tapa trasera': 102, 'Cambio chasis': 180, 'Flex de carga': 132, 'Flex varios': 72, 'Face ID': 216, 'Vidrio de camara': 58 } },
    { modelo: 'iPhone 15',          precios: { 'Placa': 312, 'Camara frontal': 107, 'Camara trasera': 90,  'Modulo original': 300,  'Modulo premium y glass': 210, 'Cambio bateria': 114, 'Cambio tapa trasera': 78, 'Cambio chasis': 168,  'Flex de carga': 102, 'Flex varios': 72, 'Face ID': 192, 'Vidrio de camara': 48 } },
    { modelo: 'iPhone 15 Plus',     precios: { 'Placa': 312, 'Camara frontal': 107, 'Camara trasera': 90,  'Modulo original': 300,  'Modulo premium y glass': 210, 'Cambio bateria': 114, 'Cambio tapa trasera': 78, 'Cambio chasis': 168,  'Flex de carga': 102, 'Flex varios': 72, 'Face ID': 192, 'Vidrio de camara': 48 } },
    { modelo: 'iPhone 15 Pro',      precios: { 'Placa': 384, 'Camara frontal': 120, 'Camara trasera': 228, 'Modulo original': 360,  'Modulo premium y glass': 252, 'Cambio bateria': 120, 'Cambio tapa trasera': 96, 'Cambio chasis': 204,  'Flex de carga': 132, 'Flex varios': 72, 'Face ID': 216, 'Vidrio de camara': 56 } },
    { modelo: 'iPhone 15 Pro Max',  precios: { 'Placa': 408, 'Camara frontal': 144, 'Camara trasera': 240, 'Modulo original': 480,  'Modulo premium y glass': 336, 'Cambio bateria': 132, 'Cambio tapa trasera': 108, 'Cambio chasis': 228, 'Flex de carga': 144, 'Flex varios': 78, 'Face ID': 240, 'Vidrio de camara': 59 } },
    // REVISAR: de aca para abajo la imagen decia "aun no disponible" en la
    // columna Cambio bateria (no un precio) -- se dejo en null.
    { modelo: 'iPhone 16',          precios: { 'Placa': 384, 'Camara frontal': 156, 'Camara trasera': 144, 'Modulo original': 360,  'Modulo premium y glass': 252, 'Cambio bateria': null, 'Cambio tapa trasera': 96, 'Cambio chasis': 192, 'Flex de carga': 204, 'Flex varios': 84, 'Face ID': 228, 'Vidrio de camara': 66 } },
    { modelo: 'iPhone 16E',         precios: { 'Placa': 324, 'Camara frontal': 156, 'Camara trasera': 144, 'Modulo original': 360,  'Modulo premium y glass': 252, 'Cambio bateria': null, 'Cambio tapa trasera': 96, 'Cambio chasis': 192, 'Flex de carga': 216, 'Flex varios': 90, 'Face ID': 228, 'Vidrio de camara': 66 } },
    { modelo: 'iPhone 16 Plus',     precios: { 'Placa': 384, 'Camara frontal': 168, 'Camara trasera': 174, 'Modulo original': 300,  'Modulo premium y glass': 210, 'Cambio bateria': null, 'Cambio tapa trasera': 114, 'Cambio chasis': 204, 'Flex de carga': 216, 'Flex varios': 96, 'Face ID': 228, 'Vidrio de camara': 66 } },
    { modelo: 'iPhone 16 Pro',      precios: { 'Placa': 432, 'Camara frontal': 192, 'Camara trasera': 264, 'Modulo original': 480,  'Modulo premium y glass': 336, 'Cambio bateria': null, 'Cambio tapa trasera': 132, 'Cambio chasis': 276, 'Flex de carga': 240, 'Flex varios': 108, 'Face ID': 276, 'Vidrio de camara': 72 } },
    { modelo: 'iPhone 16 Pro Max',  precios: { 'Placa': 456, 'Camara frontal': 216, 'Camara trasera': 300, 'Modulo original': 540,  'Modulo premium y glass': 378, 'Cambio bateria': null, 'Cambio tapa trasera': 156, 'Cambio chasis': 336, 'Flex de carga': 276, 'Flex varios': 114, 'Face ID': 312, 'Vidrio de camara': 78 } },
    { modelo: 'iPhone 17',          precios: { 'Placa': 456, 'Camara frontal': 216, 'Camara trasera': 300, 'Modulo original': 480,  'Modulo premium y glass': 336, 'Cambio bateria': null, 'Cambio tapa trasera': 156, 'Cambio chasis': 192, 'Flex de carga': 240, 'Flex varios': 120, 'Face ID': 276, 'Vidrio de camara': 96 } },
    { modelo: 'iPhone 17Air',       precios: { 'Placa': 504, 'Camara frontal': 240, 'Camara trasera': 360, 'Modulo original': 684,  'Modulo premium y glass': 479, 'Cambio bateria': null, 'Cambio tapa trasera': 180, 'Cambio chasis': 216, 'Flex de carga': 276, 'Flex varios': 144, 'Face ID': 360, 'Vidrio de camara': 120 } },
    { modelo: 'iPhone 17 Pro',      precios: { 'Placa': 600, 'Camara frontal': 300, 'Camara trasera': 420, 'Modulo original': 720,  'Modulo premium y glass': 504, 'Cambio bateria': null, 'Cambio tapa trasera': 240, 'Cambio chasis': 300, 'Flex de carga': 336, 'Flex varios': 180, 'Face ID': 420, 'Vidrio de camara': 156 } },
    // REVISAR: fila incompleta en la imagen, le falto un valor a "Flex de carga" -- puse un signo de pregunta (null) ahi, el resto se pudo leer.
    { modelo: 'iPhone 17 Pro Max',  precios: { 'Placa': 720, 'Camara frontal': 420, 'Camara trasera': 480, 'Modulo original': 840,  'Modulo premium y glass': 588, 'Cambio bateria': null, 'Cambio tapa trasera': 300, 'Cambio chasis': 372, 'Flex de carga': null, 'Flex varios': 240, 'Face ID': 480, 'Vidrio de camara': 216 } }
  ],

  // --------------------------------------------------------------
  // ACCESORIOS: catalogo + precio. MOCK.
  // --------------------------------------------------------------
  accesorios: [
    { categoria: 'Funda', descripcion: 'Silicona', modelo: 'iPhone 13', precio: 15000 },
    { categoria: 'Funda', descripcion: 'Silicona', modelo: 'iPhone 15', precio: 18000 },
    { categoria: 'Funda', descripcion: 'Transparente', modelo: 'iPhone 15', precio: 12000 },
    { categoria: 'Vidrio templado', descripcion: 'Estandar', modelo: 'iPhone 13', precio: 8000 },
    { categoria: 'Vidrio templado', descripcion: 'Estandar', modelo: 'iPhone 15', precio: 9000 },
    { categoria: 'Cargador', descripcion: '20W', modelo: 'Universal', precio: 25000 },
    { categoria: 'Auriculares', descripcion: 'Bluetooth', modelo: 'Universal', precio: 60000 }
  ], // MOCK

  // --------------------------------------------------------------
  // FINANCIACION: 4 medios de pago sin recargo (precio de lista, 1 pago) +
  // 3 promos en cuotas con recargo, a pedido del usuario. Cada 3 cuotas mas
  // suman 10 puntos de recargo (3 cuotas = 20%, 6 = 30%, 12 = 50%).
  // Si hay algo en el carrito, la financiacion se muestra sobre el total
  // sumado del carrito (categoria "equipo"); si el carrito esta vacio, se
  // muestra sobre el producto individual que se esta viendo. Ver TablaFinancia
  // en app.js.
  financiacion: [
    { plan: 'Efectivo',             interes: 0,    cuotas: 1,  categoria: 'equipo' },
    { plan: 'Debito',               interes: 0,    cuotas: 1,  categoria: 'equipo' },
    { plan: 'QR',                   interes: 0,    cuotas: 1,  categoria: 'equipo' },
    { plan: 'Transferencia',        interes: 0,    cuotas: 1,  categoria: 'equipo' },
    { plan: '3 cuotas sin interes', interes: 0.20, cuotas: 3,  categoria: 'equipo' },
    { plan: '6 cuotas',             interes: 0.30, cuotas: 6,  categoria: 'equipo' },
    { plan: '12 cuotas',            interes: 0.50, cuotas: 12, categoria: 'equipo' },

    { plan: 'Efectivo',             interes: 0,    cuotas: 1,  categoria: 'reparacion' },
    { plan: 'Debito',               interes: 0,    cuotas: 1,  categoria: 'reparacion' },
    { plan: 'QR',                   interes: 0,    cuotas: 1,  categoria: 'reparacion' },
    { plan: 'Transferencia',        interes: 0,    cuotas: 1,  categoria: 'reparacion' },
    { plan: '3 cuotas sin interes', interes: 0.20, cuotas: 3,  categoria: 'reparacion' },
    { plan: '6 cuotas',             interes: 0.30, cuotas: 6,  categoria: 'reparacion' },
    { plan: '12 cuotas',            interes: 0.50, cuotas: 12, categoria: 'reparacion' },

    { plan: 'Efectivo',             interes: 0,    cuotas: 1,  categoria: 'accesorio' },
    { plan: 'Debito',               interes: 0,    cuotas: 1,  categoria: 'accesorio' },
    { plan: 'QR',                   interes: 0,    cuotas: 1,  categoria: 'accesorio' },
    { plan: 'Transferencia',        interes: 0,    cuotas: 1,  categoria: 'accesorio' },
    { plan: '3 cuotas sin interes', interes: 0.20, cuotas: 3,  categoria: 'accesorio' },
    { plan: '6 cuotas',             interes: 0.30, cuotas: 6,  categoria: 'accesorio' },
    { plan: '12 cuotas',            interes: 0.50, cuotas: 12, categoria: 'accesorio' }
  ],

  promociones: [] // MOCK (vacio, sin promos activas)
};
