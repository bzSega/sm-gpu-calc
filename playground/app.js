'use strict';
// Setting selection only. All modelling remains in the two shared root cores.
const copy = {
  ru: {title:'Три мира GPU Calc',intro:'Отдельный подпроект. Выбираем оформление; расчёты общие с действующим симулятором.',
    worlds:[['server-room','Серверная','Люди отправляют запросы. Перед серверными стойками видна очередь, после обработки — ответы.'],['workshop','Вычислительная мастерская','Открываем стойку, выбираем карты и разбираемся, как в памяти размещаются веса модели и KV.'],['orbital','Орбитальная станция','Исследуем светлый научный отсек: запросы поступают с терминалов, а серверные стойки их обрабатывают.']],
    path:'Общий вид → выбор стойки → настройка → запуск → карты → причина ожидания',
    stage:'Пока здесь выбор мира и концепт. Игровые сцены ещё не реализованы.',
    alt:'Три ряда концептов: серверная, мастерская и орбитальная станция; общий вид, настройка, работа.',
    core:'Общее ядро подключено',note:'Контрольный сценарий: 24 запроса через 200 мс; вход 10 000, ответ 1000 токенов; две копии по восемь B200. Скорости заданы для примера, это не бенчмарк.',
    result:r=>`Завершено: ${r.completed}. Длительность: ${(r.durationMs/1000).toFixed(2)} с. Пиковая очередь: ${r.peakQueued}. Смена мира не меняет результат.`,
    error:'Не удалось выполнить расчёт. Откройте страницу через сервер из корня репозитория.',stable:'Действующий симулятор'},
  en: {title:'Three GPU Calc worlds',intro:'Separate experimental interface. Different settings share the existing simulator’s calculation cores.',
    worlds:[['server-room','Server room','People send requests. A queue forms before the server racks; replies leave after processing.'],['workshop','Computing workshop','Open a rack, choose GPU cards and explore how model weights and KV occupy memory.'],['orbital','Orbital station','Explore a bright science bay: requests arrive from terminals and server racks process them.']],
    path:'Overview → select rack → configure → run → GPU detail → explain waiting',
    stage:'Setting selection and concept art only. Game scenes are not implemented yet.',
    alt:'Three concept rows: server room, workshop and orbital station; overview, configuration and running.',
    core:'Shared core connected',note:'Control scenario: 24 requests every 200 ms; 10,000 input and 1,000 output tokens; two copies on eight B200 each. Rates are illustrative, not benchmarks.',
    result:r=>`Completed: ${r.completed}. Duration: ${(r.durationMs/1000).toFixed(2)} s. Peak queue: ${r.peakQueued}. Changing the world does not change the result.`,
    error:'Calculation failed. Serve this page from the repository root.',stable:'Current simulator'}
};
const params=new URLSearchParams(location.search);
let lang=params.get('lang')==='en'?'en':'ru';
let world=copy.ru.worlds.some(w=>w[0]===params.get('world'))?params.get('world'):'server-room';
let result=null;
try {
  const settings={model:'glm53',gpu:'B200',replicas:2,cards:8,prefill:2800,decode:84,price:5,reserve:10,concurrency:8,batchGain:50};
  const workload=Array.from({length:24},(_,i)=>({request_id:`demo-${i+1}`,arrival_ms:i*200,input_tokens:10000,output_tokens:1000}));
  result=SimCore.simulate(workload,ScenarioCore.config(settings));
} catch(error) { console.error('Shared-core control scenario failed',error); }
function render(){
  const c=copy[lang],selected=c.worlds.find(w=>w[0]===world);
  document.documentElement.lang=lang;
  for(const [id,text] of Object.entries({title:c.title,intro:c.intro,'world-title':selected[1],description:selected[2],path:c.path,'stage-note':c.stage,'core-title':c.core,'core-note':c.note,'core-status':result?c.result(result):c.error,stable:c.stable}))document.getElementById(id).textContent=text;
  document.getElementById('concept').alt=c.alt;
  document.getElementById('stable').href=`../simulation.html?lang=${lang}`;
  document.getElementById('language').textContent=lang==='ru'?'EN':'RU';
  const nav=document.getElementById('worlds');nav.replaceChildren();
  for(const [id,label] of c.worlds){const button=document.createElement('button');button.type='button';button.textContent=label;button.setAttribute('aria-pressed',String(id===world));button.onclick=()=>{world=id;updateURL();render();};nav.append(button);}
}
function updateURL(){const url=new URL(location.href);url.searchParams.set('world',world);url.searchParams.set('lang',lang);history.replaceState(null,'',url);}
document.getElementById('language').onclick=()=>{lang=lang==='ru'?'en':'ru';updateURL();render();};
render();
