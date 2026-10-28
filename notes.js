/* «Конспект»: запросы на конспект и готовые конспекты. Хранятся зашифрованными в data/notes.enc.
   Запрос создаёт Егор, конспект пишет Claude (проверка по расписанию или по просьбе в чате) через window.dz. */
(function(){
const P="data/notes.enc";
let notes=[], loaded=false, openId=null, confirmDel=false, busy=false;
const form={subject:null,from:null,to:null,detail:3,pages:0,mode:"separate",topics:""};
const DETAIL={1:"Очень кратко",2:"Кратко",3:"Обычно",4:"Подробно",5:"Всё по пунктам"};
const DETAIL_HINT={1:"только суть и главные определения",2:"главное по каждой теме в 3–5 пунктах",3:"основные определения, даты, формулы, примеры",4:"все важные пункты с пояснениями",5:"весь материал с фото, по пунктам, ничего не выкидывая"};
const MODE={separate:"Все темы, каждая отдельно",merged:"Все темы в один общий конспект",one:"Одна тема",several:"Несколько тем — в один конспект"};
const PAGES=[0,1,2,3,4,5,7,10];
const pagesLabel=p=>p?("≈ "+p+" стр. A4"):"без ограничения";
const CH_PER_PAGE=2500; // ~ one A4 page of notes
function paramsLine(n){
  const bits=[DETAIL[n.detail||3]];
  if(n.pages) bits.push("≤ "+n.pages+" стр.");
  bits.push(n.mode==="merged"?"всё вместе":n.mode==="one"?"тема: "+(n.topicsWanted||[]).join(", "):n.mode==="several"?"темы: "+(n.topicsWanted||[]).join(", "):"темы отдельно");
  return bits.join(" · ");
}
function noteChars(n){ return (n.topics||[]).reduce((a,t)=>a+(t.title||"").length+(t.summary||"").length+(t.points||[]).join("").length+(t.formulas||[]).join("").length,0); }

const css=document.createElement("style");
css.textContent=`
.nform{display:grid;gap:12px;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:16px;margin-top:18px}
.nform .row2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
@media (max-width:460px){.nform .row2{grid-template-columns:1fr}}
.seg{display:flex;flex-wrap:wrap;gap:6px}
.seg button{border:1px solid var(--line);background:var(--surface-2);border-radius:9px;padding:7px 11px;font-size:13px;font-weight:600;color:var(--muted)}
.seg button[aria-pressed="true"]{background:var(--accent);border-color:var(--accent);color:var(--accent-fg)}
.nform input[type=range]{width:100%;accent-color:var(--accent)}
.nform .val{font-size:13px;color:var(--fg);font-weight:600;text-transform:none;letter-spacing:0}
.nform .val span{color:var(--muted);font-weight:400}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.chips button{border:1px dashed var(--line);background:transparent;border-radius:999px;padding:3px 10px;font-size:12.5px;color:var(--muted)}
.chips button:hover{border-color:var(--accent);color:var(--accent)}
@media print{
  body{background:#fff!important;color:#000!important}
  header,.wk,.nview>.quick,.nsrc,#toastRoot,#sheetRoot,.notice{display:none!important}
  .wrap{max-width:none}
  .ntopic{break-inside:avoid;border:0;border-left:3px solid #999;padding:6px 12px;background:#fff}
  .nview{margin:0;gap:8px}
}
.ncard{display:grid;grid-template-columns:1fr auto;gap:6px 12px;align-items:center;background:var(--surface);border:1px solid var(--line);border-left:4px solid var(--subj,var(--line));border-radius:12px;padding:12px 14px;cursor:pointer;text-align:left;width:100%}
.ncard:hover{border-color:var(--accent)}
.ncard b{font-weight:600}
.ncard .per{grid-column:1;font-family:var(--f-mono);font-size:12px;color:var(--muted)}
.pill{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;padding:3px 8px;border-radius:999px;background:var(--surface-2);color:var(--muted);white-space:nowrap}
.pill.done{color:var(--ok);background:color-mix(in srgb,var(--ok) 14%,transparent)}
.pill.queued{color:var(--soon);background:color-mix(in srgb,var(--soon) 14%,transparent)}
.pill.error{color:var(--late);background:color-mix(in srgb,var(--late) 12%,transparent)}
.nview{margin-top:18px;display:flex;flex-direction:column;gap:14px}
.nview h2{font-family:var(--f-display);font-size:20px;margin:0;text-wrap:balance}
.ntopic{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:14px 16px;border-left:4px solid var(--subj,var(--accent))}
.ntopic h3{margin:0 0 6px;font-size:16px}
.ntopic p{margin:0 0 8px;max-width:68ch}
.ntopic ul{margin:0;padding-left:20px;display:flex;flex-direction:column;gap:4px;max-width:68ch}
.ntopic .fx{margin-top:10px;display:flex;flex-direction:column;gap:6px}
.ntopic .fx code{display:block;font-family:var(--f-mono);font-size:13px;background:var(--surface-2);border-radius:8px;padding:8px 10px;overflow-x:auto;white-space:pre}
.ntopic .src{margin-top:8px;font-size:12px;color:var(--muted)}
.nsrc{display:flex;flex-wrap:wrap;gap:6px}
.nsrc a{font-size:12.5px;color:var(--accent);text-decoration:none;border:1px solid var(--line);border-radius:999px;padding:3px 10px;background:var(--surface)}
`;
document.head.appendChild(css);

/* ---------- storage ---------- */
async function load(){
  const m=await ghMeta(P);
  notes = m ? ((await decJSON(td.decode(b64d(m.content)))).items||[]) : [];
  loaded=true; return m?m.sha:null;
}
async function mutate(op,msg){
  notes=op(notes.map(x=>({...x}))); if(view==="notes") render();
  for(let i=0;i<6;i++){
    const m=await ghMeta(P);
    const cur=m ? ((await decJSON(td.decode(b64d(m.content)))).items||[]) : [];
    const next=op(cur);
    if(await ghPut(P,btoa(await encJSON({items:next})),m?m.sha:null,msg)){ notes=next; if(view==="notes") render(); return; }
    await new Promise(r=>setTimeout(r,900));
  }
  toast("Не сохранилось, проверь интернет");
}
async function refresh(){ if(!(KEY&&TOKEN)) return; try{ await load(); if(view==="notes") render(); }catch(e){} }

/* ---------- helpers ---------- */
const fmt=s=>{ if(!s) return "…"; const d=parse(s); return pad(d.getDate())+"."+pad(d.getMonth()+1)+"."+String(d.getFullYear()).slice(2); };
const STATUS={queued:"в очереди",done:"готов",error:"не вышло",working:"пишется"};
// autumn semester starts 1 Sep, spring around 7 Feb
function semesterStart(){ const t=parse(todayIso()), y=t.getFullYear(), m=t.getMonth(); return m>=8 ? y+"-09-01" : m===0 ? (y-1)+"-09-01" : y+"-02-07"; }

/* ---------- views ---------- */
function renderList(main){
  if(!form.subject) form.subject=SUBJ_NAMES[0];
  if(!form.to) form.to=todayIso();
  if(!form.from) form.from=addDays(todayIso(),-14);
  const subj=el("select",{id:"n-subj",onchange:e=>{form.subject=e.target.value;}},
    SUBJ_NAMES.filter(s=>s!=="Физкультура").map(s=>el("option",{value:s,selected:s===form.subject},s)));
  const from=el("input",{id:"n-from",type:"date",value:form.from,onchange:e=>{form.from=e.target.value;}});
  const to=el("input",{id:"n-to",type:"date",value:form.to,onchange:e=>{form.to=e.target.value;}});
  const quick=el("div",{class:"quick"},
    [["Неделя",-7],["2 недели",-14],["Месяц",-31]].map(([l,n])=>el("button",{class:"btn small",type:"button",onclick:()=>{form.from=addDays(todayIso(),n);form.to=todayIso();render();}},l)),
    el("button",{class:"btn small",type:"button",onclick:()=>{form.from=semesterStart();form.to=todayIso();render();}},"Весь семестр"));
  const seg=(opts,cur,set)=>el("div",{class:"seg"},opts.map(([v,l])=>el("button",{type:"button","aria-pressed":String(cur===v),onclick:()=>{set(v);render();}},l)));
  const detail=el("label",{class:"f"},"Подробность",
    el("input",{id:"n-detail",type:"range",min:"1",max:"5",step:"1",value:String(form.detail),oninput:e=>{form.detail=+e.target.value; dv.replaceChildren(DETAIL[form.detail],el("span",{}," — "+DETAIL_HINT[form.detail]));}}));
  const dv=el("div",{class:"val"},DETAIL[form.detail],el("span",{}," — "+DETAIL_HINT[form.detail]));
  detail.append(dv);
  const pages=el("label",{class:"f"},"Объём",
    el("select",{id:"n-pages",onchange:e=>{form.pages=+e.target.value;}},PAGES.map(p=>el("option",{value:String(p),selected:p===form.pages},pagesLabel(p)))));
  const mode=el("div",{class:"f",style:"display:flex;flex-direction:column;gap:6px;font-size:12px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.05em"},"Темы",
    seg(Object.entries(MODE),form.mode,v=>{form.mode=v;}));
  let topicBox=null;
  if(form.mode==="one"||form.mode==="several"){
    const known=[...new Set(notes.filter(n=>n.subject===form.subject&&n.status==="done").flatMap(n=>(n.topics||[]).map(t=>t.title)).filter(Boolean))].slice(0,20);
    const inp=el("input",{id:"n-topics",value:form.topics,placeholder:form.mode==="one"?"Например: Смутное время":"Через запятую: Смута, Романовы, Пётр I",oninput:e=>{form.topics=e.target.value;}});
    topicBox=el("label",{class:"f"},form.mode==="one"?"Какая тема":"Какие темы",inp,
      known.length?el("div",{class:"chips"},known.map(t=>el("button",{type:"button",onclick:()=>{ form.topics = form.mode==="one" ? t : [...new Set(form.topics.split(",").map(x=>x.trim()).filter(Boolean).concat(t))].join(", "); render(); }},"+ "+t))):
        el("div",{class:"hint",style:"text-transform:none;letter-spacing:0;font-weight:400"},"Подсказки появятся, когда будет хотя бы один готовый конспект по предмету."));
  }
  const go=el("button",{class:"btn primary",type:"button",disabled:busy,onclick:async()=>{
    if(form.from>form.to){ toast("Дата «с» позже даты «по»"); return; }
    const topicsWanted=(form.mode==="one"||form.mode==="several") ? form.topics.split(",").map(x=>x.trim()).filter(Boolean) : [];
    if((form.mode==="one"||form.mode==="several") && !topicsWanted.length){ toast("Напиши, по какой теме сделать конспект"); return; }
    if(form.mode==="one" && topicsWanted.length>1){ toast("Для одной темы оставь одно название — или выбери «Несколько тем»"); return; }
    const p={subject:form.subject,from:form.from,to:form.to,detail:form.detail,pages:form.pages,mode:form.mode,topicsWanted};
    const key=x=>JSON.stringify([x.subject,x.from,x.to,x.detail||3,x.pages||0,x.mode||"separate",(x.topicsWanted||[]).join("|")]);
    const dup=notes.find(n=>key(n)===key(p)&&n.status!=="error");
    if(dup){ openId=dup.id; render(); return; }
    busy=true;
    const id="n"+Date.now().toString(36);
    await mutate(list=>[...list,{id,...p,status:"queued",createdAt:new Date().toISOString()}],"site: note request");
    busy=false; toast("Заявка на конспект отправлена"); render();
  }},"Сделать конспект");
  main.append(el("div",{class:"nform"},
    el("div",{class:"sectitle"},"Новый конспект"),
    el("label",{class:"f"},"Предмет",subj),
    el("div",{class:"row2"},el("label",{class:"f"},"С",from),el("label",{class:"f"},"По",to)),
    quick, detail, pages, mode, topicBox, go,
    el("p",{class:"hint",style:"margin:0"},"Claude просмотрит все фото по предмету за эти даты — из темы предмета в Telegram и прикреплённые к заданиям — и соберёт конспект по темам. Конспект появится после ближайшей проверки (будни, 17:17) или сразу, если попросить Claude в чате.")));
  const list=[...notes].sort((a,b)=>(b.createdAt||"").localeCompare(a.createdAt||""));
  if(!loaded){ main.append(el("div",{class:"empty"},"Загружаю конспекты…")); return; }
  if(!list.length){ main.append(el("div",{class:"empty"},"Конспектов пока нет. Выбери предмет и даты выше.")); return; }
  main.append(el("section",{class:"group"},
    el("div",{class:"ghead"},el("h2",{},"Конспекты"),el("span",{class:"n"},String(list.length))),
    el("div",{class:"list"},list.map(n=>el("button",{class:"ncard",style:"--subj:"+color(n.subject),onclick:()=>{openId=n.id;confirmDel=false;render();scrollTo(0,0);}},
      el("b",{},n.subject),
      el("span",{class:"pill "+(n.status||"queued")},STATUS[n.status]||n.status),
      el("span",{class:"per"},fmt(n.from)+" – "+fmt(n.to)+" · "+paramsLine(n)+(n.topics?.length?" · разделов: "+n.topics.length:"")))))));
}

function renderNote(main,n){
  const head=el("div",{class:"wk"},
    el("button",{class:"btn small",onclick:()=>{openId=null;render();}},"‹ Все конспекты"),
    el("span",{class:"pill "+(n.status||"queued")},STATUS[n.status]||n.status));
  const box=el("div",{class:"nview",style:"--subj:"+color(n.subject)},
    el("h2",{},"Конспект: "+n.subject),
    el("div",{class:"hint"},fmt(n.from)+" – "+fmt(n.to)+" · "+paramsLine(n)),
    el("div",{class:"hint"},(n.photosCount?"Просмотрено фото: "+n.photosCount:"")+(n.status==="done"?" · объём ≈ "+Math.max(1,Math.round(noteChars(n)/CH_PER_PAGE*2)/2)+" стр.":"")+(n.doneAt?" · готов "+new Date(n.doneAt).toLocaleDateString("ru-RU"):"")));
  if(n.status!=="done"){
    box.append(el("div",{class:"empty"}, n.status==="error" ? ("Не получилось: "+(n.message||"нет фото за эти даты")+".") : "Claude ещё не сделал этот конспект. Он появится после ближайшей проверки или по просьбе в чате."));
  }
  if(n.message && n.status==="done") box.append(el("div",{class:"notice",style:"margin:0"},n.message));
  (n.topics||[]).forEach(t=>box.append(el("article",{class:"ntopic"},
    el("h3",{},t.title||"Тема"),
    t.summary?el("p",{},t.summary):null,
    (t.points||[]).length?el("ul",{},t.points.map(p=>el("li",{},p))):null,
    (t.formulas||[]).length?el("div",{class:"fx"},t.formulas.map(f=>el("code",{},f))):null,
    t.source?el("div",{class:"src"},"Источник: "+t.source):null)));
  if((n.sources||[]).length) box.append(el("div",{},el("div",{class:"sectitle",style:"margin-bottom:8px"},"Откуда взято"),
    el("div",{class:"nsrc"},n.sources.map(s=>s.url?el("a",{href:s.url,target:"_blank",rel:"noopener"},(s.label||"Сообщение")+" ↗"):el("span",{class:"pill"},s.label)))));
  const foot=el("div",{class:"quick"});
  if(n.status==="done") foot.append(el("button",{class:"btn small",onclick:()=>{ try{ window.print(); }catch(e){} }},"Печать / PDF"));
  foot.append(el("button",{class:"btn small",onclick:()=>{ Object.assign(form,{subject:n.subject,from:n.from,to:n.to,detail:n.detail||3,pages:n.pages||0,mode:n.mode||"separate",topics:(n.topicsWanted||[]).join(", ")}); openId=null; render(); scrollTo(0,0); toast("Настройки скопированы — поменяй и нажми «Сделать конспект»"); }},"Другие настройки"));
  if(n.status==="done"||n.status==="error") foot.append(el("button",{class:"btn small",onclick:()=>mutate(l=>l.map(x=>x.id===n.id?{...x,status:"queued"}:x),"site: redo note").then(()=>toast("Отправил на переделку"))},"Переделать"));
  foot.append(confirmDel
    ? el("span",{class:"confirm"},"Удалить конспект?",
        el("button",{class:"btn small danger",onclick:()=>{openId=null;mutate(l=>l.filter(x=>x.id!==n.id),"site: delete note");}},"Да"),
        el("button",{class:"btn small",onclick:()=>{confirmDel=false;render();}},"Нет"))
    : el("button",{class:"btn small danger",onclick:()=>{confirmDel=true;render();}},"Удалить"));
  box.append(foot);
  main.append(head,box);
}

/* ---------- hook into the app ---------- */
const tab=el("button",{class:"tab",id:"tabNotes",role:"tab","aria-selected":"false",onclick:()=>{view="notes";openId=null;render();refresh();}},"Конспект");
$("#tabSched").after(tab);
const baseRender=render;
render=function(){
  tab.setAttribute("aria-selected",String(view==="notes"));
  if(view!=="notes"){ baseRender(); return; }
  $("#tabHw").setAttribute("aria-selected","false"); $("#tabSched").setAttribute("aria-selected","false");
  $("#toggleDone").hidden=true; $("#filters").hidden=true;
  const main=$("#main"); main.replaceChildren();
  const n=openId&&notes.find(x=>x.id===openId);
  n ? renderNote(main,n) : renderList(main);
  renderSheet();
};
const wait=setInterval(()=>{ if(window.dz&&dz.ready()){ clearInterval(wait); refresh(); setInterval(()=>{ if(document.visibilityState==="visible"&&view==="notes") refresh(); },60000); } },500);

/* ---------- API for Claude ---------- */
Object.assign(window.dz,{
  notes:()=>notes.map(x=>({...x})),
  async reloadNotes(){ await load(); return notes.length; },
  saveNote(id,patch){ return mutate(l=>l.map(x=>x.id===id?{...x,...patch}:x),"claude: note"); },
  addNote(n){ const id=n.id||("n"+Date.now().toString(36)); return mutate(l=>[...l.filter(x=>x.id!==id),{createdAt:new Date().toISOString(),...n,id}],"claude: note"); }
});
})();
