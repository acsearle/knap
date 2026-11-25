// Every built-in example for 30 simulated seconds at joint friction "realistic" (DESIGN §5.3 "With
// friction on"; shared runner in frictionExamples.ts).
import { describe, it } from 'vitest';
import { EXAMPLES } from '../../src/core/examples';
import { SECONDS, checkSweep, sweep } from './frictionExamples';

describe(`joint friction "realistic": every example for ${SECONDS} s`, () => {
  for (const ex of EXAMPLES)
    it(ex.name, { timeout: 300000 }, async () => {
      checkSweep(await sweep(ex.name, 'realistic'), true);
    });
});
