import os from 'os';
import { WebMazeGenerator } from '../src/engines/mazeGenerator';
import { TierKey } from '../src/generated';

const TIERS: TierKey[] = ['kids', 'intermediate', 'expert', 'master', 'legendary', 'ultimate'];
const WARMUP_COUNT = 100;
const SAMPLE_COUNT = 1000;

console.log('='.repeat(70));
console.log('LOGICORE MAZE GENERATOR ENGINE BENCHMARK');
console.log(`OS: ${os.type()} ${os.release()} (${os.arch()}) | CPU Cores: ${os.cpus().length}`);
console.log(`Node: ${process.version} | V8: ${process.versions.v8}`);
console.log(`Warmup: ${WARMUP_COUNT} iterations | Samples: ${SAMPLE_COUNT} iterations per tier`);
console.log('='.repeat(70));

// JIT 預熱
for (let i = 0; i < WARMUP_COUNT; i++) {
  WebMazeGenerator.generate('kids', undefined, i);
}

for (const tier of TIERS) {
  const times: number[] = [];
  let fallbackCount = 0;

  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const t0 = performance.now();
    const result = WebMazeGenerator.generate(tier, undefined, (i + 1) * 31337);
    const duration = performance.now() - t0;
    times.push(duration);

    if (result.checksum?.includes('FALLBACK')) {
      fallbackCount++;
    }
  }

  times.sort((a, b) => a - b);
  const p50 = times[Math.floor(SAMPLE_COUNT * 0.5)].toFixed(2);
  const p95 = times[Math.floor(SAMPLE_COUNT * 0.95)].toFixed(2);
  const p99 = times[Math.floor(SAMPLE_COUNT * 0.99)].toFixed(2);
  const mean = (times.reduce((a, b) => a + b, 0) / SAMPLE_COUNT).toFixed(2);
  const fallbackRate = ((fallbackCount / SAMPLE_COUNT) * 100).toFixed(2);

  console.log(
    `[${tier.toUpperCase().padEnd(12)}] Mean: ${mean.padStart(6)}ms | P50: ${p50.padStart(6)}ms | P95: ${p95.padStart(6)}ms | P99: ${p99.padStart(6)}ms | Fallback: ${fallbackRate}%`
  );
}
console.log('='.repeat(70));
