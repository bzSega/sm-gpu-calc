// Learning observes the same service; it never changes arrivals or serving state.
'use strict';
const StartupLessons=(()=>{
 const clone=x=>JSON.parse(JSON.stringify(x));
 const text={
  ru:[
   {id:'placement',title:'Разместите модель',task:'Установите GPU, выберите модель и проверьте, хватает ли памяти. Если не хватает — измените карты или модель.',action:'К стойке',question:'Что остаётся в памяти, пока модель запущена?',answers:['Веса модели','Только ответы пользователей'],correct:0,explanation:'Веса загружаются при запуске модели и остаются в памяти. Рядом нужен резерв среды и место для KV запросов.'},
   {id:'reply',title:'Получите первый ответ',task:'Откройте сервис. Люди начнут отправлять запросы. Дождитесь первого ответа и откройте карту.',action:'К сервису',question:'Что происходит с KV запроса после ответа?',answers:['Хранится навсегда','Освобождается для следующих запросов'],correct:1,explanation:'KV нужен во время обработки запроса. В этой модели он выделяется целиком при старте и освобождается после ответа.'},
   {id:'queue',title:'Разберите очередь',task:'Увеличьте приход людей. Когда появится очередь, посмотрите причину. Затем уменьшите поток или добавьте копии и дождитесь, пока очередь исчезнет.',action:'К потоку людей',question:'Почему можно ждать при почти свободной памяти?',answers:['Разрешённые места обработки заняты','Свободная память всегда означает, что очереди быть не может'],correct:0,explanation:'Лимит программы и память — разные ограничения. Когда разрешённые запросы уже в работе, следующий ждёт, даже если KV ещё помещается.'},
   {id:'long',title:'Сравните длину запросов',task:'В потоке людей выберите длинный документ. Дождитесь ответа на такой запрос. Сравните его KV с коротким запросом.',action:'Выбрать запросы',question:'Длинный документ при той же модели обычно требует…',answers:['Столько же KV, потому что GPU тот же','Больше KV: в запросе больше токенов'],correct:1,explanation:'При той же модели размер KV зависит от числа токенов. Больше входа и ответа — больше памяти запроса; время также зависит от скорости и совместной работы.'},
   {id:'memory',title:'Найдите ограничение памяти',task:'Создайте очередь из-за нехватки KV. Для выбранной модели подойдёт пример ниже. Затем добавьте память или верните обычные запросы и дождитесь ответа.',action:'К стойке',question:'Место обработки есть, KV не хватает. Поможет ли только увеличить лимит?',answers:['Да, память появится из-за нового лимита','Нет, нужен свободный KV для ещё одного запроса'],correct:1,explanation:'Разрешение программы не добавляет память. Нужны меньший запрос, больше памяти группы или другая копия с доступным KV. Ранее принятые длинные запросы сохраняются.'},
   {id:'launch',title:'Измените профиль запуска',task:'Откройте настройки копии, которая получает запросы. Измените лимит активных запросов и дождитесь ответа, начатого с новым лимитом. Если копия простаивает, увеличьте приток людей. При недостатке памяти сначала увеличьте её или верните короткий запрос.',action:'Настроить обработку',question:'Число разрешённых активных запросов задаёт…',answers:['Программа запуска модели; реальный выбор проверяют замерами','Только объём памяти GPU автоматически'],correct:0,explanation:'Лимит задаёт программа. В реальной системе его подбирают по памяти, скорости и задержкам. В игре скорости и кривая совместной обработки — явные учебные допущения.'}
  ],
  en:[
   {id:'placement',title:'Place the model',task:'Install GPUs, choose a model and check memory. If it does not fit, change the GPUs or model.',action:'Go to rack',question:'What stays in memory while the model is running?',answers:['Model weights','Only user replies'],correct:0,explanation:'Weights are loaded when the model starts and remain in memory. Runtime reserve and request KV also need room.'},
   {id:'reply',title:'Send the first reply',task:'Open the service. People will send requests. Wait for the first reply and inspect a GPU.',action:'Go to service',question:'What happens to a request’s KV after its reply?',answers:['It is kept forever','It is freed for later requests'],correct:1,explanation:'KV is needed during request processing. This model reserves it in full on admission and frees it after the reply.'},
   {id:'queue',title:'Explain the queue',task:'Increase arrivals. When a queue forms, inspect the reason. Then lower arrivals or add copies and wait for the queue to clear.',action:'Go to visitors',question:'Why can requests wait while memory is mostly free?',answers:['Configured processing places are occupied','Free memory always prevents a queue'],correct:0,explanation:'The program limit and memory are separate constraints. A request waits when all permitted places are occupied, even if more KV would fit.'},
   {id:'long',title:'Compare request lengths',task:'Choose a long document in visitor settings. Wait for a reply to that request. Compare its KV with a short request.',action:'Choose requests',question:'With the same model, a long document usually needs…',answers:['The same KV because the GPU is unchanged','More KV because it has more tokens'],correct:1,explanation:'With the same model, KV size depends on token count. More input and output need more request memory; time also depends on rates and sharing.'},
   {id:'memory',title:'Find the memory constraint',task:'Create a queue blocked by KV, using the setup below. Then add memory or return to regular requests and wait for a reply.',action:'Go to rack',question:'A processing place is free, but KV is insufficient. Will a higher limit alone help?',answers:['Yes, raising the limit creates memory','No, another request needs enough free KV'],correct:1,explanation:'A program limit does not create memory. Use a smaller request, more group memory or another copy with free KV. Previously accepted long requests remain intact.'},
   {id:'launch',title:'Change the launch profile',task:'Open processing settings for a copy receiving requests. Change its active-request limit and wait for a reply started under the new limit. Increase arrivals if the copy is idle. If memory is tight, add memory or return to short requests first.',action:'Configure processing',question:'The active-request limit is set by…',answers:['The model-serving program; real choices need measurements','GPU memory size alone, automatically'],correct:0,explanation:'The program sets the limit. Real systems tune it against memory, throughput and latency. Game rates and sharing are explicit teaching assumptions.'}
  ]
 };
 const flags=['gpuSeen','placed','reply','slotsSeen','slotsCleared','shortSeen','longSeen','memorySeen','memoryCleared','launchWorked'];
 function create(saved){
  let data={schema:'ai-startup-lessons/1',enabled:true,index:0,answered:false,attempts:[],lastAnswer:null,flags:Object.fromEntries(flags.map(k=>[k,false])),slotsCompleted:null,memoryCompleted:null,launch:null,shortKV:null,longKV:null};
  if(saved!==undefined){
   if(!saved||saved.schema!==data.schema||typeof saved.enabled!=='boolean'||!Number.isInteger(saved.index)||saved.index<0||saved.index>6||typeof saved.answered!=='boolean'||!saved.flags||flags.some(k=>k==='gpuSeen'?saved.flags[k]!==undefined&&typeof saved.flags[k]!=='boolean':typeof saved.flags[k]!=='boolean'))throw Error('Invalid learning save');
   for(const key of ['slotsCompleted','memoryCompleted','shortKV','longKV'])if(saved[key]!==null&&(!Number.isFinite(saved[key])||saved[key]<0))throw Error('Invalid learning evidence');
   if(saved.launch!==null&&(!saved.launch||!Number.isInteger(saved.launch.copy)||saved.launch.copy<1||saved.launch.copy>64||!Number.isInteger(saved.launch.limit)||saved.launch.limit<1||saved.launch.limit>256||!Number.isFinite(saved.launch.time)||saved.launch.time<0))throw Error('Invalid launch evidence');
   const current=text.ru[saved.index],attempts=saved.attempts===undefined?(saved.answered&&current?[current.correct]:[]):saved.attempts,lastAnswer=saved.lastAnswer===undefined?(attempts.at(-1)??null):saved.lastAnswer;
   if(!Array.isArray(attempts)||attempts.length>2||new Set(attempts).size!==attempts.length||attempts.some(i=>!Number.isInteger(i)||i<0||i>1)||
     (lastAnswer===null?attempts.length>0:!attempts.includes(lastAnswer))||saved.index===6&&(attempts.length>0||saved.answered)||current&&(saved.answered?lastAnswer!==current.correct:attempts.includes(current.correct)))throw Error('Invalid answer feedback');
   data={attempts:[...attempts],lastAnswer,schema:data.schema,enabled:saved.enabled,index:saved.index,answered:saved.answered,flags:Object.fromEntries(flags.map(k=>[k,!!saved.flags[k]])),...Object.fromEntries(['slotsCompleted','memoryCompleted','shortKV','longKV','launch'].map(k=>[k,clone(saved[k])]))};
  }
  function ready(){if(data.answered)return true;return [data.flags.placed,data.flags.reply&&data.flags.gpuSeen,data.flags.slotsCleared,data.flags.shortSeen&&data.flags.longSeen,data.flags.memoryCleared,data.flags.launchWorked][data.index]||false;}
  const api={
   observe(state,records=[],event){
    if(state.model&&state.memory?.fits)data.flags.placed=true;
    const live=state.live;if(!live)return api.inspect();
    if(live.completed>0)data.flags.reply=true;if(event?.type==='gpu')data.flags.gpuSeen=true;
    if(live.queued>0&&live.waitingReason==='slots'&&live.replicas.some(r=>r.kvUsedGB<r.config.kvCapacityGB*.5)){data.flags.slotsSeen=true;if(data.slotsCompleted===null)data.slotsCompleted=live.completed;}
    if(data.flags.slotsSeen&&live.queued===0&&live.completed>data.slotsCompleted)data.flags.slotsCleared=true;
    if(live.queued>0&&live.waitingReason==='memory'){data.flags.memorySeen=true;if(data.memoryCompleted===null)data.memoryCompleted=live.completed;}
    if(data.flags.memorySeen&&live.waitingReason!=='memory'&&live.completed>data.memoryCompleted)data.flags.memoryCleared=true;
    if(event?.type==='launch'&&event.before!==event.limit)data.launch={copy:event.copy,limit:event.limit,time:live.timeMs};
    for(const r of records)if(r.endMs!==null){
     if(r.input_tokens===10000&&r.output_tokens===1000){data.flags.shortSeen=true;data.shortKV=r.kvGB;}
     if(r.input_tokens===120000&&r.output_tokens===8000){data.flags.longSeen=true;data.longKV=r.kvGB;}
     if(data.launch&&r.replica===data.launch.copy&&r.startMs>data.launch.time&&live.replicas.find(w=>w.id===r.replica)?.config.concurrency===data.launch.limit)data.flags.launchWorked=true;
    }
    return api.inspect();
   },
   inspect(){return {...clone(data),feedback:data.lastAnswer===null?null:{answer:data.lastAnswer,correct:data.lastAnswer===text.ru[data.index]?.correct},ready:ready(),done:data.index===6};},
   lesson(lang='ru'){return clone(text[lang]?.[data.index]||null);},
   answer(index,lang='ru'){const lesson=api.lesson(lang);if(data.answered)throw Error('Answer already accepted');if(!lesson||!ready()||!Number.isInteger(index)||index<0||index>1)throw Error('Learning task not ready');const correct=index===lesson.correct;data.lastAnswer=index;if(!data.attempts.includes(index))data.attempts.push(index);if(correct)data.answered=true;return {correct,explanation:lesson.explanation};},
   next(){if(!data.answered||!ready())throw Error('Answer the current task first');data.index++;data.answered=false;data.attempts=[];data.lastAnswer=null;return api.inspect();},
   setEnabled(value){if(typeof value!=='boolean')throw Error('Invalid learning mode');data.enabled=value;return api.inspect();},
   save(){return clone(data);}
  };return api;
 }
 return {create};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=StartupLessons;
if(typeof window!=='undefined')window.StartupLessons=StartupLessons;
