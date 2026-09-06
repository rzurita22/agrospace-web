const DEFAULT_GAS_URL = "https://script.google.com/macros/s/AKfycbzZlNbZ9v1U2fsIKBpAJMbeuAt2kM2GK0Bg7Ic2q1KejJdQzbIg8bLD_Mt-QOB-mAUnoQ/exec";

export default async (request) => {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ok:false,error:"Metodo no permitido"}), {
      status:405, headers:{"content-type":"application/json; charset=utf-8"}
    });
  }

  try {
    const entrada = await request.json();
    const gasUrl = Netlify.env.get("GAS_WEB_APP_URL") || DEFAULT_GAS_URL;
    const respuesta = await fetch(gasUrl, {
      method:"POST",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({
        accion:"rpc",
        funcion:entrada.funcion,
        args:Array.isArray(entrada.args) ? entrada.args : [],
        token:String(entrada.token || "")
      }),
      redirect:"follow"
    });

    const texto = await respuesta.text();
    let datos;
    try { datos = JSON.parse(texto); }
    catch (_) { throw new Error("Apps Script no devolvio JSON valido"); }

    return new Response(JSON.stringify(datos), {
      status:respuesta.ok ? 200 : 502,
      headers:{
        "content-type":"application/json; charset=utf-8",
        "cache-control":"no-store"
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({ok:false,error:String(error?.message || error)}), {
      status:500,
      headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}
    });
  }
};
