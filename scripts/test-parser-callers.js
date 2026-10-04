// Every AI feature that calls _estParseJSON, fed a realistic reply in exactly the
// shape its own prompt asks for, through the REAL parser extracted from
// demo.html -- never a copy. A probe that used its own lenient parser reported
// "parses: yes" while the app returned null, which is how 8 of 15 features sat
// broken: plan transcription, Good-Better-Best, Measure Materials (fence and
// slab), Job Report, Selections, Toolbox Talk and Compliance suggestions.
//
// Each case states what its caller checks before it will render anything.
//   node scripts/test-parser-callers.js            # tests demo.html
//   node scripts/test-parser-callers.js other.html # tests another build
const fs=require('fs');
const file=process.argv[2]||'demo.html';
const src=fs.readFileSync(file,'utf8');
const m=src.match(/function _estParseJSON\(text\)\{[\s\S]*?\n\}/);
const P=new Function(m[0]+'; return _estParseJSON;')();
const C=[
 ['Plan read — pass 1 transcription', '{"areaSchedule":[{"label":"MAIN FLOOR","sqft":1312}],"totalPrintedSqft":2486,"stories":2,"rooms":[{"name":"LIVING","dims":"19x16"}],"overallDims":{"widthFt":42,"depthFt":34},"conflicts":[]}', o=>o&&o.totalPrintedSqft===2486],
 ['Plan read — pass 2 takeoff', '{"items":[{"desc":"Framing","qty":1,"unit":"ls","price":100}],"notes":"n","assumptions":[],"questions":[],"totalSqft":2486,"geometry":{"rooms":[{"name":"A","x":0,"y":0,"w":1,"h":1}]}}', o=>o&&o.items&&o.items.length===1&&o.totalSqft===2486],
 ['Takeoff followed by a stray summary blob', '{"items":[{"desc":"A","qty":1,"unit":"ea","price":1},{"desc":"B","qty":2,"unit":"ea","price":2}],"notes":"x"}\nSummary: {"stories":1}', o=>o&&o.items&&o.items.length===2],
 ['Takeoff truncated mid-object', '{"items":[{"desc":"A","qty":1,"unit":"ea","price":1},{"desc":"B","qty":2,"unit":"ea","pri', o=>o&&o.items&&o.items.length>=1],
 ['Generate line items (text estimate)', '```json\n{"items":[{"desc":"Panel upgrade","qty":1,"unit":"ea","price":3200}],"notes":"x"}\n```', o=>o&&o.items&&o.items.length],
 ['Good · Better · Best', '{"tiers":[{"name":"Good","tagline":"t","items":[{"desc":"a","qty":1,"unit":"ea","price":10}],"notes":"n"},{"name":"Better","tagline":"t","items":[{"desc":"a","qty":1,"unit":"ea","price":20},{"desc":"b","qty":1,"unit":"ea","price":5}],"notes":"n"},{"name":"Best","tagline":"t","items":[{"desc":"a","qty":1,"unit":"ea","price":30},{"desc":"b","qty":1,"unit":"ea","price":9},{"desc":"c","qty":1,"unit":"ea","price":9}],"notes":"n"}]}', o=>o&&o.tiers&&o.tiers.length===3],
 ['Measure materials — fence', '{"kind":"fence","fence":{"type":"wire","linearFeet":400,"heightFt":5,"corners":4,"gates":1}}', o=>o&&o.kind==='fence'],
 ['Measure materials — countertop slab', '{"kind":"slab","pieces":[{"name":"Island","w":96,"h":42,"qty":1},{"name":"Run","w":120,"h":25.5,"qty":2}]}', o=>o&&o.kind==='slab'&&o.pieces.length===2],
 ['Job report from photos', '{"percent":60,"phase":"Framing","completed":["walls up"],"next":["roof"],"issues":["rain"],"summary":"ok"}', o=>o&&o.percent===60],
 ['Pricebook — Build with AI', '{"items":[{"name":"Outlet","category":"Electrical","unit":"ea","price":85}]}', o=>o&&o.items&&o.items.length],
 ['Selections — AI Suggest', '{"selections":[{"category":"Flooring","options":[{"label":"LVP","price":6500},{"label":"Oak","price":11200}]}]}', o=>o&&o.selections&&o.selections.length===1],
 ['Safety — Toolbox Talk', '{"topic":"Trench safety","hazards":["cave-in"],"controls":["shore"],"keyPoints":["never enter"]}', o=>o&&o.topic],
 ['Punch list — AI', '{"items":[{"desc":"Touch up paint","location":"Hall"}]}', o=>o&&o.items&&o.items.length],
 ['Equipment — AI Suggest', '{"items":[{"name":"Laser level","category":"Tools"}]}', o=>o&&o.items&&o.items.length],
 ['Compliance — AI Suggest certs', '{"certs":[{"cert":"OSHA 10","months":60},{"cert":"First Aid","months":24}]}', o=>o&&o.certs&&o.certs.length===2],

 ['Prose before the JSON', 'Here is the transcription you asked for:\n{"totalPrintedSqft":2486,"stories":2,"areaSchedule":[{"label":"MAIN","sqft":1312}]}\nLet me know.', o=>o&&o.totalPrintedSqft===2486],
 ['Transcription truncated mid-object', '{"totalPrintedSqft":2486,"stories":2,"areaSchedule":[{"label":"MAIN","sqft":1312},{"label":"UPPER","sqft":11', o=>o&&o.totalPrintedSqft===2486],
 ['Pass 2 echoes the transcription, then the takeoff', '{"totalPrintedSqft":2486,"stories":2,"areaSchedule":[{"label":"MAIN","sqft":1312},{"label":"UPPER","sqft":1174},{"label":"GARAGE","sqft":484}],"rooms":[{"name":"LIVING","dims":"19x16"},{"name":"KITCHEN","dims":"14x16"},{"name":"DINING","dims":"13x12"}]}\n{"items":[{"desc":"Framing","qty":1,"unit":"ls","price":100}],"notes":"n"}', o=>o&&o.items&&o.items.length===1],
 ['Draft takeoff then a fuller final takeoff', '{"items":[{"desc":"A","qty":1,"unit":"ea","price":1}]}\n{"items":[{"desc":"A","qty":1,"unit":"ea","price":1},{"desc":"B","qty":1,"unit":"ea","price":1},{"desc":"C","qty":1,"unit":"ea","price":1}],"notes":"final"}', o=>o&&o.items&&o.items.length===3],
 ['Good-Better-Best inside a code fence', '```json\n{"tiers":[{"name":"Good","items":[{"desc":"a","qty":1,"unit":"ea","price":1}]},{"name":"Better","items":[{"desc":"a","qty":1,"unit":"ea","price":2}]},{"name":"Best","items":[{"desc":"a","qty":1,"unit":"ea","price":3}]}]}\n```', o=>o&&o.tiers&&o.tiers.length===3],
 ['Good-Better-Best truncated in the last tier', '{"tiers":[{"name":"Good","items":[{"desc":"a","qty":1,"unit":"ea","price":1}]},{"name":"Better","items":[{"desc":"a","qty":1,"unit":"ea","price":2}]},{"name":"Best","items":[{"desc":"a","qty":1,"unit":"ea","pri', o=>o&&o.tiers&&o.tiers.length>=2],
 ['Braces inside strings do not confuse it', '{"topic":"Use {braces} and } carefully","hazards":["a { b"],"controls":[],"keyPoints":[]}', o=>o&&o.topic==='Use {braces} and } carefully'],
 ['Trailing commas tolerated', '{"selections":[{"category":"Floor","options":[{"label":"Oak","price":1},],},],}', o=>o&&o.selections&&o.selections.length===1],
];
let pass=0,fail=0;
for(const [name,reply,ok] of C){
  let r; try{ r=P(reply);}catch(e){ r='THREW '+e.message; }
  const good=typeof r==='object'&&ok(r);
  if(good)pass++;else fail++;
  console.log((good?'  works   ':'  BROKEN  ')+name+(good?'':'   -> got '+(r===null?'null':JSON.stringify(r).slice(0,70))));
}
console.log((fail?'\n\u274c  ':'\n\u2705  ')+pass+' of '+(pass+fail)+' AI feature replies parse into what their caller needs.\n');
process.exit(fail?1:0);
