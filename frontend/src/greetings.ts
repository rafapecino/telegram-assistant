type Birthday = {name?:unknown; day?:unknown; month?:unknown};
const GREETINGS = [
  '¿Qué pasa, Petzi? 👋','Buenas, Rafa 😏','¿Qué quieres ahora, pringao? 🙄','Aquí estoy, cabrón 😎','Dime, Rafa 👊',
  'A sus órdenes, Petzi 🫡','¿Otra vez por aquí, Rafa? 😂','¿Qué tal la tesis, ingeniero? 📚','¿Ya vas por la segunda energética, Petzi? 🥤',
  'Mira quién se ha acordado de mí 🙃','¿Hoy toca gimnasio o excusa, Rafa? 🏋️','Habla, cabrón, que no muerdo 🐶',
  '¿Vienes a ver cuánto has gastado, pringao? 💸','Petzi, el ingeniero más procrastinador de Madrid 🏆','Bienvenido a tu centro de mando, Rafa 🚀',
  '¿Otra pausa de la tesis, Petzi? 👀','Aquí tu asistente, más currante que tú 💪','¿Qué se le ofrece al señorito? 🎩',
  'Rafa, que te veo venir 🕵️','Venga, Petzi, sorpréndeme 🎲',
  '¿Qué pasa, máquina? ⚙️','Dime, fiera 🦁','Hombre, el crack ha vuelto ⚽','¿Qué se cuenta la figura? 🗿','A tus pies, campeón 🏅',
  '¿Qué tramas, bribón? 😼','Hola, golfo, ¿de dónde vienes? 🌙','Menudo elemento tenemos aquí 🧪','¿Qué hay, pájaro? 🐦',
  'Llegó el fenómeno 🌪️','Buenas, mamón 😜','¿Qué quieres, melón? 🍈','Dime, cenutrio, que tengo prisa 🏃',
  'Bienvenido, señor ingeniero 👷','¿Cómo va eso, doctorando? 🎓','¿Y ahora qué, listillo? 🤓','Habla, tronco 🌳','¿Qué pasa, tigre? 🐯',
  'Hola, sinvergüenza 😈','¿Qué necesitas, maestro? 🧙','Dime, artista 🎨','A ver, canalla, ¿qué has liado? 🃏','Buenas, jefe 💼',
];

const SPECIAL:Record<string,string[]>={
 '01-01':['¡Feliz año, Rafa! Un día cada vez, que el año acaba de empezar 🎉','Rafa, año nuevo: pocas promesas y buenos planes ✨'],
 '01-05':['Rafa, esta noche vienen los Reyes. Disimula lo de este año 👑'],
 '01-06':['¡Feliz día de Reyes, Rafa! A ver si han acertado contigo 👑'],
 '02-14':['Rafa, hoy también cuenta quererse un poquito a uno mismo ❤️'],
 '03-19':['Rafa, hoy es San José y el Día del Padre. Un buen día para acordarse de los tuyos 💛'],
 '05-01':['Rafa, hoy es el Día del Trabajo. La lista también puede esperar un rato ☕'],
 '10-31':['Rafa, hoy es Halloween. Que los únicos sustos sean de mentira 🎃','¡Feliz Halloween, Rafa! Hoy hasta los pendientes dan menos miedo 👻'],
 '11-01':['Rafa, hoy es un buen día para recordar con cariño a quienes echas de menos 🕯️'],
 '12-24':['¡Feliz Nochebuena, Rafa! Hoy lo importante cabe alrededor de una mesa 🎄'],
 '12-25':['¡Feliz Navidad, Rafa! Disfruta de los tuyos y deja sitio para el postre 🎄','Rafa, hoy toca Navidad: buena compañía y cero prisas 🎁'],
 '12-28':['Rafa, hoy es el Día de los Inocentes. Cuidado con lo que te cuentan 😏'],
 '12-31':['Rafa, último día del año. Quédate con lo bueno y prepara las uvas 🍇','Rafa, hoy cerramos capítulo. ¡Que el siguiente venga con buenos planes! 🥂'],
};
const WEEKLY=[
 ['Rafa, domingo de bajar una marcha y dejar mañana encaminado ☕','Petzi, hoy también vale descansar sin remordimientos 🌿'],
 ['Rafa, lunes: empieza por una cosa y ya iremos viendo 💪','Petzi, estrenamos semana. Vamos a ponerle un poco de orden 🧭'],
 ['Rafa, martes: hoy se avanza sin hacer mucho ruido 🚀','Petzi, una cosa menos en la lista ya es una victoria ✅'],
 ['Rafa, miércoles: ya estamos cruzando el ecuador de la semana ⛵','Petzi, mitad de semana. Respira y sigue a tu ritmo 🌿'],
 ['Rafa, jueves: el fin de semana ya se deja ver 👀','Petzi, deja algo resuelto hoy y mañana te lo agradecerás ✨'],
 ['Rafa, viernes: remata lo importante y haz sitio para disfrutar 🎉','Petzi, el viernes no se organiza solo. ¿Qué plan tenemos? 😎'],
 ['Rafa, sábado: hoy también hay que hacer hueco para vivir ☀️','Petzi, que la lista no te quite un buen sábado 🥐'],
];
/** Solo usa cumpleaños guardados y la fecha de Madrid; no inventa compromisos ni festivos. */
export function contextualGreeting(birthdays:Birthday[]=[],now=new Date()):string{
 const date=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 const [,month,day]=date.split('-').map(Number);
 const index=Math.floor(Date.parse(date+'T00:00:00Z')/86400000);
 const names=[...new Set(birthdays.filter(b=>Number(b.month)===month&&Number(b.day)===day).map(b=>typeof b.name==='string'?b.name.trim():'').filter(Boolean))];
 if(names.length){
  const shown=names.slice(0,2);
  const people=names.length>2?shown.join(', ')+` y ${names.length-2} persona${names.length===3?'':'s'} más`:shown.join(' y ');
  return `Rafa, recuerda felicitar a ${people}. ¡Hoy es su cumpleaños! 🎂`;
 }
 const special=SPECIAL[date.slice(5)];
 if(special)return special[index%special.length];
 // Una semana de cada tres conserva el saludo de siempre; el resto varía con el día y la estación.
 const weekday=new Date(date+'T12:00:00Z').getUTCDay();
 const seasonal=month>=6&&month<=8?['Rafa, modo verano: lo importante primero y luego un respiro ☀️']:month>=9&&month<=11?['Rafa, otoño pide un café y un poco de orden 🍂']:month===12||month<=2?['Rafa, hace época de manta; vamos a dejar el día organizado ☕']:['Rafa, primavera: un buen momento para dar aire a tus planes 🌼'];
 const pool=index%3===0?GREETINGS:index%3===1?WEEKLY[weekday]:[...WEEKLY[weekday],...seasonal];
 return pool[Math.floor(index/7)%pool.length];
}
