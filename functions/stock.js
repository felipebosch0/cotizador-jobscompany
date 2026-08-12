// ============================================================
// Funcion serverless (Cloudflare Pages Functions) que lee el stock EN VIVO
// desde el Google Sheet de inventario, via el export CSV publico de Google
// (gviz). Portado 1 a 1 desde netlify/functions/stock.js (migracion de
// Netlify a Cloudflare Pages por limite de creditos del plan gratis).
//
// Mismas columnas y reglas que cotizador-appscript/Stock.gs (ObtenerStock):
// hoja "Inventario iPhones", A=Modelo, B=Bateria, C=Color, D=Capacidad,
// E=IMEI (no se usa aca), F=Sucursal/deposito, G=Estado, H=Ultimo
// movimiento (no se usa), I=Observaciones, J=Propietario (no se usa). Solo
// se devuelven filas con Estado "En Stock" o "Reservado".
//
// ID de la planilla:
// https://docs.google.com/spreadsheets/d/1WFl9nKbYYyOuz6ZLLzCNpnhrgd5qWqveP_IXmKG_1HE/edit
// ============================================================

const LIBRO_STOCK_ID = '1WFl9nKbYYyOuz6ZLLzCNpnhrgd5qWqveP_IXmKG_1HE';
const NOMBRE_HOJA_INVENTARIO = 'Inventario iPhones';
const ESTADOS_STOCK_VISIBLES = ['En Stock', 'Reservado'];

function csvUrl() {
  return 'https://docs.google.com/spreadsheets/d/' + LIBRO_STOCK_ID +
    '/gviz/tq?tqx=out:csv&sheet=' + encodeURIComponent(NOMBRE_HOJA_INVENTARIO);
}

function parseCsv(texto) {
  const filas = [];
  let fila = [];
  let campo = '';
  let entreComillas = false;

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (entreComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; }
        else entreComillas = false;
      } else {
        campo += c;
      }
    } else if (c === '"') {
      entreComillas = true;
    } else if (c === ',') {
      fila.push(campo);
      campo = '';
    } else if (c === '\n') {
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = '';
    } else if (c === '\r') {
      // ignorar, el \n de al lado cierra la fila
    } else {
      campo += c;
    }
  }
  if (campo.length || fila.length) { fila.push(campo); filas.push(fila); }
  return filas;
}

function bateriaAPorcentaje(valorCrudo) {
  const limpio = String(valorCrudo || '').replace('%', '').trim();
  const num = Number(limpio);
  if (!num) return 0;
  return Math.round(num <= 1 ? num * 100 : num);
}

function capacidadANumero(valorCrudo) {
  const texto = String(valorCrudo || '');
  if (/t/i.test(texto)) return 1024; // "1T"/"1t" -> 1024
  return Number(texto) || 0;
}

export async function onRequestGet() {
  try {
    const response = await fetch(csvUrl());
    if (!response.ok) throw new Error('Google Sheets respondio ' + response.status);
    const texto = await response.text();

    if (/^\s*<!DOCTYPE html/i.test(texto)) {
      throw new Error('La planilla no es publica (Compartir > Cualquiera con el enlace > Lector)');
    }

    const filas = parseCsv(texto).slice(1); // saco el encabezado

    const stock = [];
    filas.forEach(fila => {
      const modelo = String(fila[0] || '').trim();
      const estado = String(fila[6] || '').trim();
      if (!modelo || !estado) return; // fila vacia
      if (ESTADOS_STOCK_VISIBLES.indexOf(estado) === -1) return; // "Vendido", etc.

      stock.push({
        modelo: modelo,
        capacidad: capacidadANumero(fila[3]),
        bateria: bateriaAPorcentaje(fila[1]),
        color: String(fila[2] || '').trim(),
        sucursal: String(fila[5] || '').trim(),
        estado: estado,
        observaciones: String(fila[8] || '').trim()
      });
    });

    return new Response(
      JSON.stringify({ stock: stock, error: null }),
      { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ stock: [], error: String(error.message || error) }),
      { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
    );
  }
}
