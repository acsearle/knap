# Engine battery: the things that hurt knap in Rapier

One physical world, simulated by any engine in whatever internal units suit it best.
**All results are reported in real units**: lengths in studs (1 stud = 8 mm), time in real
seconds, speeds in studs/s, angles in rad. Real gravity is 9.81 m/s² = 1226.25 studs/s² along −Y.
Material: uniform density (the value is free; a real part is about 0.3 g per stud cube).
Friction 0.5, restitution 0 unless a test says otherwise. Sleeping/deactivation OFF.
The product's frame budget: it steps physics at 1/480 s of real time and can afford roughly
1 ms of CPU per such step for a 6-body mechanism. A result bought with far smaller steps must
say so, and give the cost (ms of CPU per real second simulated, Node, this machine).

Shapes use real dimensions: a "cube" is 0.92 studs on a side (half 0.46); a "beam n" is a box
n × 0.92 × 0.92 studs; a "wheel r" is a cylinder of radius r studs and length 0.92.

| id | scene | report |
|---|---|---|
| B1a | cube resting on a fixed box floor, 2 s | sink below touching (studs); drift speed at the end |
| B1b | cube on a loose (dynamic) beam 9 that lies on the floor, 2 s | sink of cube into beam, and beam into floor |
| B1c | stack of 5 cubes on the floor, then the same with the top cube 10× denser, 3 s | total compression; does it stand |
| B2 | cube dropped flat onto the floor, hitting at 150 and at 300 studs/s | deepest penetration, rebound speed, sideways speed and spin after impact |
| B3 | free fall for 1.5 s (no floor) | speed at 0.5, 1.0, 1.5 s against g·t (613, 1226, 1839); any clamp |
| B4a | box 0.16×0.1×0.16 resting on the top face of a fixed regular 32-gon prism (radius 0.5, depth 0.5), at the centre and at 6 off-centre spots, 2 s | tilt, sink, fell through? number of contact points |
| B4b | dynamic 16-gon and 32-gon prism (radius 0.5, length 0.92) lying on its flat end on the floor (infinite plane if the engine has one, else a big box), 2 s | tilt, sink, contact points |
| B5a | wheel r 1 lying on its curved side on a fixed box floor (40×1×40), at rest, and with a gentle 1 stud/s roll, 5 s | speed over time (does it speed up by itself?); same on an infinite plane |
| B5b | wheel r 1 rolling at 100 studs/s on the floor for 2 s | speed kept (%), sink while rolling |
| B5c | wheel r 2.5 standing on its rim, resting on a loose beam 9 that lies on the floor, 2 s | sink of wheel into beam; does it stay |
| B6a | pendulum: beam 7 hinged at one end to the world (hinge axis horizontal), released from horizontal, no friction, 10 s | energy change (% of m·g·L swing energy); hinge separation error (studs) |
| B6b | triple pendulum: three beam-7 links hinged end to end, released from horizontal, 10 s | energy change after 10 s (%), worst hinge separation |
| B7 | free body in zero gravity: a beam 5 with a cube stuck on one end at right angles (so the inertia is asymmetric), spinning at 20 rad/s about an axis that is NOT a principal axis, 30 s | change of rotational energy and of |angular momentum| (%) per second |
| B8 | gears: two wheels (r 1 and r 2.5) on parallel hinges to the world, 3.5 studs apart, coupled 2.5:1 by the engine's gear constraint if it has one; a constant torque spins the small one up from rest to 100 rad/s, then released | ratio error over time (teeth of a 16/40 pair, or rad), energy bookkeeping (work in vs kinetic energy), behaviour at 300 rad/s |
| B9 | hinge extras, yes/no with the API name: joint friction (constant torque), motor with max torque, angle limits, one-way (ratchet-like) limit, reading the joint's reaction force | list |
| B10 | cost: the B6b triple pendulum plus a 20-cube pile on the floor | ms of CPU per real second simulated at the settings used above |

For each test say PASS / MARGINAL / FAIL against "would a person building toy mechanisms notice",
with the numbers. If an engine has no way to do a test (no gear constraint), say so; that is a result.
