const ALLOWED_FEEDS = new Set([
  "ws90", "wh51", "esp32", "presion", "wfc01", "bomba"
]);

function json(body, status = 200, cache = "no-store") {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": cache
    }
  });
}

function env(name) {
  const value = Netlify.env.get(name);
  if (!value) throw new Error(`Falta configurar ${name} en Netlify`);
  return value;
}

function validarFeed(feed) {
  if (!ALLOWED_FEEDS.has(feed)) throw new Error(`Feed no permitido: ${feed}`);
  return feed;
}

async function adafruitFetch(url, key) {
  const hacerFetch = async (usarKey) => {
    const headers = { "Accept": "application/json" };
    if (usarKey && key) headers["X-AIO-Key"] = key;
    return fetch(url, { headers });
  };

  let response = await hacerFetch(true);
  if (!response.ok && key) {
    response = await hacerFetch(false);
  }
  if (!response.ok) {
    const texto = await response.text().catch(() => "");
    throw new Error(`Adafruit ${response.status}${texto ? `: ${texto.slice(0,180)}` : ""}`);
  }
  return response.json();
}

async function latest(username, key, feed) {
  validarFeed(feed);
  const url = `https://io.adafruit.com/api/v2/${encodeURIComponent(username)}/feeds/${encodeURIComponent(feed)}/data?limit=1`;
  const datos = await adafruitFetch(url, key);
  return Array.isArray(datos) && datos.length ? datos[0] : null;
}

async function history(username, key, feed, start, end) {
  validarFeed(feed);
  const inicio = new Date(start);
  const fin = new Date(end);
  if (!Number.isFinite(inicio.getTime()) || !Number.isFinite(fin.getTime()) || inicio > fin)
    throw new Error("Rango historico invalido");

  const limite = 1000;
  const todos = [];
  let cursorFin = new Date(fin.getTime());

  for (let pagina = 0; pagina < 60; pagina++) {
    const url = `https://io.adafruit.com/api/v2/${encodeURIComponent(username)}/feeds/${encodeURIComponent(feed)}/data` +
      `?limit=${limite}&start_time=${encodeURIComponent(inicio.toISOString())}&end_time=${encodeURIComponent(cursorFin.toISOString())}`;
    const lote = await adafruitFetch(url, key);
    if (!Array.isArray(lote) || lote.length === 0) break;
    todos.push(...lote);
    if (lote.length < limite) break;
    const masViejo = new Date(lote[lote.length - 1].created_at);
    if (!Number.isFinite(masViejo.getTime()) || masViejo <= inicio) break;
    const nuevoCursor = new Date(masViejo.getTime() - 1);
    if (nuevoCursor >= cursorFin) break;
    cursorFin = nuevoCursor;
  }

  const vistos = new Set();
  return todos.filter(d => {
    const id = d.id || `${d.created_at}_${d.value}`;
    if (vistos.has(id)) return false;
    vistos.add(id);
    return true;
  });
}

export default async (request) => {
  if (request.method !== "GET") return json({ok:false,error:"Metodo no permitido"}, 405);

  try {
    const username = env("ADAFRUIT_USERNAME");
    const key = env("ADAFRUIT_AIO_KEY");
    const url = new URL(request.url);
    const mode = url.searchParams.get("mode") || "latest";

    if (mode === "latest") {
      const feed = validarFeed(url.searchParams.get("feed") || "");
      return json({ok:true,data:await latest(username,key,feed)}, 200, "no-store");
    }

    if (mode === "batch-latest") {
      const feeds = [...new Set((url.searchParams.get("feeds") || "")
        .split(",").map(x => x.trim()).filter(Boolean).map(validarFeed))];
      if (!feeds.length) throw new Error("No se indicaron feeds");
      const errores = {};
      const resultados = await Promise.all(feeds.map(async feed => {
        try {
          return [feed, await latest(username,key,feed)];
        } catch (error) {
          errores[feed] = String(error?.message || error);
          return [feed, null];
        }
      }));
      return json({
        ok:true,
        data:Object.fromEntries(resultados),
        diagnostic:{
          usernameConfigured:Boolean(username),
          keyConfigured:Boolean(key),
          errors:errores
        }
      }, 200, "no-store");
    }

    if (mode === "history") {
      const feed = validarFeed(url.searchParams.get("feed") || "");
      const start = url.searchParams.get("start");
      const end = url.searchParams.get("end");
      return json({ok:true,data:await history(username,key,feed,start,end)}, 200, "no-store");
    }

    return json({ok:false,error:"Modo no valido"}, 400);
  } catch (error) {
    return json({ok:false,error:String(error?.message || error)}, 500);
  }
};