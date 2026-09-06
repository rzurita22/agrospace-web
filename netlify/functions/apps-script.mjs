import { getStore } from "@netlify/blobs";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const READ_FEEDS = new Set([
  "ws90","wh51","esp32","presion","wfc01","bomba-comando","bomba-ack","config","config-ack"
]);
const WRITE_FEEDS = new Set(["bomba-comando","config"]);
const ENSURE_FEEDS = new Set(["bomba-comando","bomba-ack","config","config-ack","esp32"]);
function store(){ return getStore("agrospace-backend", { consistency: "strong" }); }

const SENSORES_ALERTA = {
  temperatura:{nombre:"Temperatura",unidad:"°C",feed:"ws90",indice:0},
  humedad:{nombre:"Humedad ambiente",unidad:"%",feed:"ws90",indice:1},
  viento:{nombre:"Viento promedio",unidad:"km/h",feed:"ws90",indice:3},
  racha:{nombre:"Racha",unidad:"km/h",feed:"ws90",indice:4},
  radiacion:{nombre:"Radiación",unidad:"lux",feed:"ws90",indice:5},
  uv:{nombre:"Índice UV",unidad:"",feed:"ws90",indice:6},
  dewpoint:{nombre:"Punto de rocío",unidad:"°C",feed:"ws90",indice:7},
  lluvia:{nombre:"Precipitación",unidad:"mm/h",feed:"ws90",indice:8},
  moisture:{nombre:"Humedad del suelo",unidad:"%",feed:"wh51",wh51:true},
  presion:{nombre:"Presión",unidad:"hPa",feed:"presion",directo:true},
  caudal:{nombre:"Caudal",unidad:"L/min",feed:"wfc01",indice:0}
};

function json(body,status=200){
  return new Response(JSON.stringify(body),{
    status,
    headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}
  });
}
function env(name,fallback=""){ return Netlify.env.get(name)||fallback; }
function aioUsername(){ return env("ADAFRUIT_USERNAME","rzurita22"); }
function aioKey(){ const k=env("ADAFRUIT_AIO_KEY"); if(!k) throw new Error("Falta ADAFRUIT_AIO_KEY en Netlify"); return k; }
function b64url(input){ return Buffer.from(input).toString("base64url"); }
function fromB64url(input){ return Buffer.from(input,"base64url").toString("utf8"); }
function sha256(text){ return createHash("sha256").update(String(text)).digest("hex"); }
function safeEq(a,b){
  const A=Buffer.from(String(a)), B=Buffer.from(String(b));
  return A.length===B.length && timingSafeEqual(A,B);
}

async function aioFetch(path, options={}){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(), options.timeoutMs || 8000);
  try{
    const response=await fetch("https://io.adafruit.com/api/v2/"+encodeURIComponent(aioUsername())+path,{
      method:options.method||"GET",
      headers:{"X-AIO-Key":aioKey(),"Accept":"application/json",...(options.json?{"Content-Type":"application/json"}:{})},
      body:options.json?JSON.stringify(options.json):undefined,
      signal:controller.signal
    });
    const text=await response.text();
    let data=null;
    if(text){ try{ data=JSON.parse(text); } catch{ data=text; } }
    if(!response.ok){
      const msg=typeof data==="object"&&data?.error ? data.error : String(text||"").slice(0,180);
      const e=new Error("Adafruit HTTP "+response.status+(msg?": "+msg:""));
      e.status=response.status;
      throw e;
    }
    return data;
  } finally { clearTimeout(timer); }
}

async function latest(feed){
  if(!READ_FEEDS.has(feed)) throw new Error("Feed no permitido: "+feed);
  return aioFetch("/feeds/"+encodeURIComponent(feed)+"/data/last",{timeoutMs:4000});
}
async function publish(feed,value){
  if(!WRITE_FEEDS.has(feed)) throw new Error("Feed de escritura no permitido: "+feed);
  return aioFetch("/feeds/"+encodeURIComponent(feed)+"/data",{method:"POST",json:{value:String(value)},timeoutMs:5000});
}
async function ensureFeed(feed){
  if(!ENSURE_FEEDS.has(feed)) throw new Error("Feed no permitido: "+feed);
  try{
    await aioFetch("/feeds/"+encodeURIComponent(feed),{timeoutMs:4000});
    return {creado:false,feed};
  }catch(e){
    if(e.status!==404) throw e;
    await aioFetch("/feeds",{method:"POST",json:{name:feed,key:feed},timeoutMs:5000});
    return {creado:true,feed};
  }
}

async function authRecord(){ return await store().get("auth/password",{type:"json"}); }
async function passwordFingerprint(){
  const rec=await authRecord();
  if(rec?.hash) return rec.hash;
  const p=env("AGROSPACE_ACCESS_PASSWORD");
  if(!p) throw new Error("Falta AGROSPACE_ACCESS_PASSWORD en Netlify");
  return sha256("env:"+p);
}
async function verifyPassword(password){
  const rec=await authRecord();
  if(rec?.hash && rec?.salt){ return safeEq(sha256(rec.salt+":"+password),rec.hash); }
  const p=env("AGROSPACE_ACCESS_PASSWORD");
  if(!p) throw new Error("Falta AGROSPACE_ACCESS_PASSWORD en Netlify");
  return safeEq(password,p);
}
async function signToken(payload){
  const body=b64url(JSON.stringify(payload));
  const secret=await passwordFingerprint();
  const sig=createHmac("sha256",secret).update(body).digest("base64url");
  return body+"."+sig;
}
async function verifyToken(token){
  if(!token || !String(token).includes(".")) throw new Error("Sesión inválida");
  const [body,sig]=String(token).split(".");
  const secret=await passwordFingerprint();
  const expected=createHmac("sha256",secret).update(body).digest("base64url");
  if(!safeEq(sig,expected)) throw new Error("Sesión inválida");
  let payload;
  try{ payload=JSON.parse(fromB64url(body)); }catch{ throw new Error("Sesión inválida"); }
  if(!payload.exp || Date.now()>payload.exp) throw new Error("Sesión vencida");
  return payload;
}
async function iniciarSesionAgrospace(clave){
  if(!await verifyPassword(String(clave||""))) throw new Error("Contraseña incorrecta");
  const exp=Date.now()+7*24*60*60*1000;
  return {token:await signToken({iat:Date.now(),exp}),expira:exp};
}
async function verificarSesionAgrospace(token){ await verifyToken(token); return {ok:true}; }
async function cambiarClaveAccesoAgrospace(anterior,nueva,token){
  if(!nueva || String(nueva).length<6) throw new Error("La nueva contraseña debe tener al menos 6 caracteres");
  if(!(await verifyPassword(String(anterior||"")))){
    if(token) await verifyToken(token); else throw new Error("Contraseña actual incorrecta");
  }
  const salt=randomBytes(16).toString("hex");
  await store().setJSON("auth/password",{salt,hash:sha256(salt+":"+String(nueva)),updated_at:new Date().toISOString()});
  return {ok:true};
}

function validarTelegram(config){
  if(!config || !String(config.telegramToken||"").trim() || !String(config.telegramChatId||"").trim())
    throw new Error("Falta configurar el token del bot o el Chat ID.");
}
function validarConfigAlertas(config){
  validarTelegram(config);
  if(!config.reglas || typeof config.reglas!=="object") throw new Error("Las reglas de alerta no son válidas.");
}
async function enviarTelegram(config,texto){
  validarTelegram(config);
  const response=await fetch("https://api.telegram.org/bot"+config.telegramToken+"/sendMessage",{
    method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({chat_id:config.telegramChatId,text:texto})
  });
  const body=await response.json().catch(()=>({}));
  if(!response.ok || !body.ok) throw new Error(body.description||("Telegram HTTP "+response.status));
  return {confirmado:true};
}
function extraerValor(sensor,raw){
  if(sensor.directo) return Number(raw);
  if(sensor.wh51){ const p=String(raw||"").split(",")[0].split(":"); return Number(p[1]); }
  return Number(String(raw||"").split(",")[sensor.indice]);
}
async function obtenerConfigAlertasServidor(){ return await store().get("alerts/config",{type:"json"}); }
export async function evaluarAlertasServidor(forzar=false){
  const config=await obtenerConfigAlertasServidor();
  const resultado={avisos:[],enviado:false,reglasActivas:0,datosValidos:0,error:""};
  if(!config){ resultado.error="No hay configuración guardada en Netlify."; return resultado; }
  try{ validarTelegram(config); }catch(e){ resultado.error=e.message; return resultado; }
  const estado=(await store().get("alerts/state",{type:"json"}))||{};
  const ultimos=(await store().get("alerts/last",{type:"json"}))||{};
  const cooldownMs=Math.max(1,Number(config.cooldown)||30)*60000;
  const ahora=Date.now();
  const feeds=[...new Set(Object.entries(config.reglas||{}).filter(([id,r])=>r?.activa&&SENSORES_ALERTA[id]).map(([id])=>SENSORES_ALERTA[id].feed))];
  const settled=await Promise.allSettled(feeds.map(f=>latest(f)));
  const rawByFeed={};
  feeds.forEach((f,i)=>{ if(settled[i].status==="fulfilled") rawByFeed[f]=settled[i].value?.value??""; });
  for(const [id,regla] of Object.entries(config.reglas||{})){
    const sensor=SENSORES_ALERTA[id];
    if(!regla?.activa || !sensor) continue;
    resultado.reglasActivas++;
    const valor=extraerValor(sensor,rawByFeed[sensor.feed]);
    if(!Number.isFinite(valor)) continue;
    resultado.datosValidos++;
    const minimo=regla.min===""?null:Number(regla.min), maximo=regla.max===""?null:Number(regla.max);
    let condicion="normal",detalle="";
    if(minimo!==null&&Number.isFinite(minimo)&&valor<minimo){ condicion="min"; detalle="debajo del mínimo "+minimo; }
    else if(maximo!==null&&Number.isFinite(maximo)&&valor>maximo){ condicion="max"; detalle="supera el máximo "+maximo; }
    const clave=id+":"+condicion;
    if(condicion!=="normal" && (forzar||condicion!==(estado[id]||"normal")) && (forzar||ahora-Number(ultimos[clave]||0)>=cooldownMs)){
      resultado.avisos.push("⚠️ "+sensor.nombre+": "+valor+" "+sensor.unidad+" ("+detalle+")");
      ultimos[clave]=ahora;
    }
    estado[id]=condicion;
  }
  await store().setJSON("alerts/state",estado);
  await store().setJSON("alerts/last",ultimos);
  if(resultado.avisos.length){
    const fecha=new Intl.DateTimeFormat("es-AR",{timeZone:"America/Argentina/Cordoba",dateStyle:"short",timeStyle:"medium"}).format(new Date());
    await enviarTelegram(config,"🚨 ALERTA AGROSPACE\n\n"+resultado.avisos.join("\n")+"\n\n"+fecha);
    resultado.enviado=true;
  }
  return resultado;
}
async function guardarConfigAlertasServidor(config){ validarConfigAlertas(config); await store().setJSON("alerts/config",config); return evaluarAlertasServidor(true); }
async function probarTelegramServidor(config){ return enviarTelegram(config,"✅ Agrospace: alertas del servidor configuradas correctamente."); }

async function chatMeteoxServidor(){
  if(!env("OPENAI_API_KEY")) throw new Error("Falta OPENAI_API_KEY en Netlify para activar METEOX IA");
  throw new Error("METEOX IA todavía no fue migrado al backend Netlify");
}

async function dispatch(funcion,args,requestToken){
  switch(funcion){
    case "leerUltimoDatoServidor": return latest(String(args[0]||""));
    case "publicarDatoDashboardServidor": {
      const token=String(args[2]||requestToken||""); await verifyToken(token);
      return publish(String(args[0]||""),args[1]);
    }
    case "asegurarFeedAdafruitServidor": {
      const token=String(args[1]||requestToken||""); await verifyToken(token); return ensureFeed(String(args[0]||""));
    }
    case "obtenerConfigAlertasServidor": return obtenerConfigAlertasServidor();
    case "guardarConfigAlertasServidor": return guardarConfigAlertasServidor(args[0]);
    case "probarTelegramServidor": return probarTelegramServidor(args[0]);
    case "evaluarAlertasServidor": return evaluarAlertasServidor(Boolean(args[0]));
    case "iniciarSesionAgrospace": return iniciarSesionAgrospace(args[0]);
    case "verificarSesionAgrospace": return verificarSesionAgrospace(args[0]||requestToken);
    case "cambiarClaveAccesoAgrospace": return cambiarClaveAccesoAgrospace(args[0],args[1],args[2]||requestToken);
    case "chatMeteoxServidor": { await verifyToken(args[2]||requestToken); return chatMeteoxServidor(args[0],args[1],args[2]); }
    default: throw new Error("Función no soportada por Netlify: "+funcion);
  }
}

export default async (request)=>{
  if(request.method!=="POST") return json({ok:false,error:"Método no permitido"},405);
  try{
    const entrada=await request.json();
    const resultado=await dispatch(String(entrada.funcion||""),Array.isArray(entrada.args)?entrada.args:[],String(entrada.token||""));
    return json({ok:true,resultado});
  }catch(error){
    return json({ok:false,error:String(error?.message||error)},400);
  }
};
