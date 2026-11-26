// Did B7 Euler blow up and auto-reset? Prints MuJoCo warnings and |omega| over time.
// Run: node b7_warn.mjs
import { mj, preset, header, v3, compile, step, HC } from './lib.mjs';
for (const [integ, dt] of [['Euler',1/480],['Euler',1/1920],['implicitfast',1/480],['RK4',1/480]]) {
  const p = preset('default',1,{integrator:integ, dt});
  const {m,d}=compile(`${header(p,{gravity:false})}<worldbody><body><freejoint/><geom type="box" size="${v3(p,2.5,HC,HC)}" contype="0" conaffinity="0"/><geom type="box" size="${v3(p,HC,HC,HC)}" pos="${v3(p,2,2*HC,0)}" contype="0" conaffinity="0"/></body></worldbody></mujoco>`);
  const s=20/Math.sqrt(3); d.qvel[3]=s; d.qvel[4]=s; d.qvel[5]=s;
  const out=[];
  for (const t of [0.1,0.5,1,2,5,10,30]) { while(d.time<t-1e-9 && d.time>=0) { const tb=d.time; step(m,d); if (d.time<tb) {out.push(`RESET@${tb.toFixed(3)}`); break;} } out.push(`${t}:${Math.hypot(d.qvel[3],d.qvel[4],d.qvel[5]).toFixed(2)}`); if (out.at(-2)?.startsWith('RESET')) break; }
  const w = d.warning; const ws=[]; for (let i=0;i<w.size?.() ?? 0;i++){}
  let warn=''; try { for (let i=0;i<8;i++){ const wi=d.warning.get ? d.warning.get(i) : d.warning[i]; if (wi && wi.number) warn+=` w${i}:${wi.number}@t${wi.lastinfo}`; } } catch(e){ warn=' (warnings unreadable: '+e.message+')'; }
  console.log(integ, `dt=1/${Math.round(1/dt)}`, out.join(' '), warn);
}
process.exit(0);
