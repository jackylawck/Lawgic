// 點選切換水平邊 (含提示豁免)
  const toggleHEdge = (r: number, c: number) => {
    if (isCompleted) return;

    const isHintExempt =
      activeHintStep &&
      activeHintStep.edge.type === 'h' &&
      activeHintStep.edge.r === r &&
      activeHintStep.edge.c === c;

    if (isNoGuessMode && hEdges[r][c] === 0 && !isHintExempt) {
      const deductions = WebSlitherlinkGenerator.getStrictDeductions(rows, cols, clues, hEdges, vEdges);
      const deduction = deductions.get(`h_${r}_${c}`);

      if (!deduction) {
        setGuessWarning(
          isEn
            ? '🤔 Not a forced move yet! Check zero corners or vertex degrees first.'
            : '🤔 這條邊還不是必然定式喔！先觀察 0 的四周或端點度數吧。'
        );
        setTimeout(() => setGuessWarning(null), 3000);
        return;
      }
    }

    setGuessWarning(null);
    setHintLevel(0);
    setActiveHintStep(null);

    setHEdges((prev) => {
      const next = prev.map((row) => [...row]);
      next[r][c] = ((next[r][c] + 1) % 3) as EdgeState;
      if (checkVictory(next, vEdges)) triggerVictory();
      return next;
    });
    if (navigator.vibrate) navigator.vibrate(8);
  };

  // 點選切換垂直邊 (含提示豁免)
  const toggleVEdge = (r: number, c: number) => {
    if (isCompleted) return;

    const isHintExempt =
      activeHintStep &&
      activeHintStep.edge.type === 'v' &&
      activeHintStep.edge.r === r &&
      activeHintStep.edge.c === c;

    if (isNoGuessMode && vEdges[r][c] === 0 && !isHintExempt) {
      const deductions = WebSlitherlinkGenerator.getStrictDeductions(rows, cols, clues, hEdges, vEdges);
      const deduction = deductions.get(`v_${r}_${c}`);

      if (!deduction) {
        setGuessWarning(
          isEn
            ? '🤔 Not a forced move yet! Check zero corners or vertex degrees first.'
            : '🤔 這條邊還不是必然定式喔！先觀察 0 的四周或端點度數吧。'
        );
        setTimeout(() => setGuessWarning(null), 3000);
        return;
      }
    }

    setGuessWarning(null);
    setHintLevel(0);
    setActiveHintStep(null);

    setVEdges((prev) => {
      const next = prev.map((row) => [...row]);
      next[r][c] = ((next[r][c] + 1) % 3) as EdgeState;
      if (checkVictory(hEdges, next)) triggerVictory();
      return next;
    });
    if (navigator.vibrate) navigator.vibrate(8);
  };
