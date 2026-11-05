import { NextResponse } from 'next/server';

const SYMBOLS = [
  { id: 'ace', weight: 20, multiplier: 5 },
  { id: 'king', weight: 25, multiplier: 4 },
  { id: 'queen', weight: 30, multiplier: 3 },
  { id: 'jack', weight: 35, multiplier: 2 },
  { id: 'joker', weight: 5, multiplier: 15 },
  { id: 'crown', weight: 3, multiplier: 25 },
];

function getRandomSymbolId(): string {
  const totalWeight = SYMBOLS.reduce((sum, s) => sum + s.weight, 0);
  let random = Math.random() * totalWeight;
  for (const symbol of SYMBOLS) {
    if (random < symbol.weight) return symbol.id;
    random -= symbol.weight;
  }
  return SYMBOLS[0].id;
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const betAmount = Number(body?.betAmount);

    if (!betAmount || betAmount < 1) {
      return NextResponse.json({ error: 'Stake must be at least 1' }, { status: 400 });
    }

    const cols = 5;
    const rows = 4;

    const matrix: string[][] = [];
    for (let c = 0; c < cols; c++) {
      const column: string[] = [];
      for (let r = 0; r < rows; r++) {
        column.push(getRandomSymbolId());
      }
      matrix.push(column);
    }

    let winAmount = 0;
    const winningLines: number[] = [];

    for (let r = 0; r < rows; r++) {
      const firstSymbol = matrix[0][r];
      let matchCount = 1;

      for (let c = 1; c < cols; c++) {
        if (matrix[c][r] === firstSymbol) {
          matchCount++;
        } else {
          break;
        }
      }

      if (matchCount >= 3) {
        const symbolConfig = SYMBOLS.find((s) => s.id === firstSymbol);
        const payout = betAmount * (symbolConfig?.multiplier || 1) * (matchCount * 0.5);
        winAmount += payout;
        winningLines.push(r);
      }
    }

    return NextResponse.json({
      matrix,
      winAmount: Math.round(winAmount),
      isWin: winAmount > 0,
      winningLines,
    });
  } catch (err) {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

