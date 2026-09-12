use criterion::{black_box, criterion_group, criterion_main, BatchSize, Criterion};
use sudoku_wasm::{bfs_propagate, BitMask, SudokuEngine, ALL_CANDIDATES};

const HARDEST_17_CLUE: [u8; 81] = [
    0, 0, 0, 0, 0, 0, 0, 1, 0,
    4, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 2, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 5, 0, 4, 0, 7,
    0, 0, 8, 0, 0, 0, 3, 0, 0,
    0, 0, 1, 0, 9, 0, 0, 0, 0,
    3, 0, 0, 4, 0, 0, 2, 0, 0,
    0, 5, 0, 1, 0, 0, 0, 0, 0,
    0, 0, 0, 8, 0, 6, 0, 0, 0,
];

fn bench_bfs_propagation(c: &mut Criterion) {
    c.bench_function("bfs_propagate_single_cell", |b| {
        b.iter_batched(
            || {
                let mut cells: [BitMask; 81] = [ALL_CANDIDATES; 81];
                let mut queue: [u8; 81] = [0u8; 81];
                let mut queued: [bool; 81] = [false; 81];
                cells[0] = 1 << 1;
                queue[0] = 0;
                queued[0] = true;
                (cells, queue, queued)
            },
            |(mut cells, mut queue, mut queued)| {
                bfs_propagate(black_box(&mut cells), &mut queue, &mut queued, 1);
            },
            BatchSize::SmallInput,
        );
    });
}

fn bench_engine_solution_verification(c: &mut Criterion) {
    let engine = SudokuEngine::new(&HARDEST_17_CLUE).expect("Failed to initialize 17-clue benchmark puzzle");

    c.bench_function("verify_solution_count_hardest_17_clue", |b| {
        b.iter(|| {
            black_box(engine.verify_solution_count());
        });
    });
}

criterion_group!(benches, bench_bfs_propagation, bench_engine_solution_verification);
criterion_main!(benches);
