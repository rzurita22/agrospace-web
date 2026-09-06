const ALLOWED_FEEDS = new Set([
  "ws90", "wh51", "esp32", "presion", "wfc01"
]);

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function validarFeed(feed) {
  if (!ALLOWED_FEEDS.has(feed)) throw new Error("Feed no permitido: " + feed);
  return feed;
}

function gasUrl() {
  const url = Netlify.env.get("GAS_WEB_APP_URL") || Netlify.env.get("APPS_SCRIPT_URL");
  if (!url) throw new Error("Falta GAS_WEB_APP_URL/APPS_SCRIPT_URL");
  return url;
}

async function gasRpc(funcion, args = []) {
  const response = await fetch(gasUrl(), {
    method: "POST",
    headers: {"content-type":"application/json"},
    body: JSON.stringify({
      accion: "rpc",
      funcion,
      args,
      token: ""
    }),
    redirect: "follow"
  });

  const texto = await response.text();
  let payload;
  try { payload = JSON.parse(texto); }
  catch (_) { throw new Error("Apps Script no devolvio JSON valido"); }

  if (!response.ok || !payload.ok) {
    throw new Error(payload?.error || ("Apps Script HTTP " + response.status));
  }
  return payload.resultado;
}

export default async (request) => {
  if (request.method !== "GET") {
    return json({ok:false,error:"Metodo no permitido"}, 405);
  }

  try {
    const url = new URL(request.url);
    const mode = url.searchParams.get("mode") || "latest";

    if (mode === "latest") {
      const feed = validarFeed(url.searchParams.get("feed") || "");
      const dato = await gasRpc("leerUltimoDatoServidor", [feed]);
      return json({ok:true,data:dato || null,source:"apps-script"});
    }

    if (mode === "batch-latest") {
      const feeds = [...new Set(
        (url.searchParams.get("feeds") || "")
          .split(",")
          .map(x => x.trim())
          .filter(Boolean)
          .map(validarFeed)
      )];

      if (!feeds.length) throw new Error("No se indicaron feeds");

      const resultados = await Promise.all(
        feeds.map(async feed => {
          try {
            const dato = await gasRpc("leerUltimoDatoServidor", [feed]);
            return [feed, dato || null];
          } catch (error) {
            return [feed, null];
          }
        })
      );

      return json({
        ok:true,
        data:Object.fromEntries(resultados),
        source:"apps-script-parallel"
      });
    }

    if (mode === "history") {
      const feed = validarFeed(url.searchParams.get("feed") || "");
      const start = url.searchParams.get("start");
      const end = url.searchParams.get("end");
      const datos = await gasRpc("leerHistoricoServidor", [feed, start, end]);
      return json({ok:true,data:Array.isArray(datos) ? datos : [],source:"apps-script"});
    }

    return json({ok:false,error:"Modo no valido"}, 400);
  } catch (error) {
    return json({ok:false,error:String(error?.message || error)}, 500);
  }
};
