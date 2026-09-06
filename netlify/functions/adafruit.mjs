const ALLOWED_FEEDS = new Set(["ws90","wh51","esp32","wfc01","presion"]);

function json(body,status=200){
  return new Response(JSON.stringify(body),{
    status,
    headers:{
      "content-type":"application/json; charset=utf-8",
      "cache-control":"no-store"
    }
  });
}

function validarFeed(feed){
  if(!ALLOWED_FEEDS.has(feed)) throw new Error("Feed no permitido: "+feed);
  return feed;
}

function env(name,fallback=""){
  return Netlify.env.get(name)||fallback;
}

async function adafruitFetch(url,key,timeoutMs=3000){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetch(url,{
      headers:{
        "X-AIO-Key":key,
        "Accept":"application/json"
      },
      signal:controller.signal
    });
    if(!response.ok){
      const texto=await response.text().catch(()=> "");
      throw new Error("Adafruit HTTP "+response.status+(texto?": "+texto.slice(0,120):""));
    }
    return await response.json();
  }finally{
    clearTimeout(timer);
  }
}

async function latest(username,key,feed){
  validarFeed(feed);
  const url="https://io.adafruit.com/api/v2/"+encodeURIComponent(username)+
    "/feeds/"+encodeURIComponent(feed)+"/data/last";
  const dato=await adafruitFetch(url,key,3000);
  return dato&&typeof dato==="object"?dato:null;
}

async function history(username,key,feed,start,end){
  validarFeed(feed);
  const inicio=new Date(start);
  const fin=new Date(end);
  if(!Number.isFinite(inicio.getTime())||!Number.isFinite(fin.getTime())||inicio>fin)
    throw new Error("Rango historico invalido");

  const limite=1000;
  const todos=[];
  let cursorFin=new Date(fin.getTime());

  for(let pagina=0;pagina<60;pagina++){
    const url="https://io.adafruit.com/api/v2/"+encodeURIComponent(username)+
      "/feeds/"+encodeURIComponent(feed)+"/data"+
      "?limit="+limite+
      "&start_time="+encodeURIComponent(inicio.toISOString())+
      "&end_time="+encodeURIComponent(cursorFin.toISOString());

    const lote=await adafruitFetch(url,key,8000);
    if(!Array.isArray(lote)||!lote.length) break;
    todos.push(...lote);
    if(lote.length<limite) break;

    const masViejo=new Date(lote[lote.length-1].created_at);
    if(!Number.isFinite(masViejo.getTime())||masViejo<=inicio) break;
    cursorFin=new Date(masViejo.getTime()-1);
  }

  const vistos=new Set();
  return todos.filter(d=>{
    const id=d.id||(d.created_at+"_"+d.value);
    if(vistos.has(id)) return false;
    vistos.add(id);
    return true;
  });
}

export default async(request)=>{
  if(request.method!=="GET") return json({ok:false,error:"Metodo no permitido"},405);

  try{
    const username=env("ADAFRUIT_USERNAME","rzurita22");
    const key=env("ADAFRUIT_AIO_KEY");
    if(!key) throw new Error("Falta ADAFRUIT_AIO_KEY en Netlify");

    const url=new URL(request.url);
    const mode=url.searchParams.get("mode")||"latest";

    if(mode==="latest"){
      const feed=validarFeed(url.searchParams.get("feed")||"");
      const dato=await latest(username,key,feed);
      return json({ok:true,data:dato,source:"adafruit-last"});
    }

    if(mode==="batch-latest"){
      const feeds=[...new Set((url.searchParams.get("feeds")||"")
        .split(",").map(x=>x.trim()).filter(Boolean).map(validarFeed))];
      if(!feeds.length) throw new Error("No se indicaron feeds");

      const t0=Date.now();
      const settled=await Promise.allSettled(
        feeds.map(feed=>latest(username,key,feed))
      );

      const data={};
      const errors={};
      feeds.forEach((feed,i)=>{
        const r=settled[i];
        if(r.status==="fulfilled") data[feed]=r.value;
        else{
          data[feed]=null;
          errors[feed]=String(r.reason?.message||r.reason);
        }
      });

      return json({
        ok:true,
        data,
        source:"adafruit-last-parallel",
        elapsed_ms:Date.now()-t0,
        errors
      });
    }

    if(mode==="history"){
      const feed=validarFeed(url.searchParams.get("feed")||"");
      const data=await history(
        username,key,feed,
        url.searchParams.get("start"),
        url.searchParams.get("end")
      );
      return json({ok:true,data,source:"adafruit-history"});
    }

    return json({ok:false,error:"Modo no valido"},400);
  }catch(error){
    return json({ok:false,error:String(error?.message||error)},500);
  }
};