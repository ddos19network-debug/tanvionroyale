import { Controller, Post, Body, HttpCode, HttpStatus, BadRequestException } from '@nestjs/common';

const SYMBOLS = [
  { id: 'ace', weight: 20, multiplier: 5 },
  { id: 'king', weight: 25, multiplier: 4 },
  { id: 'queen', weight: 30, multiplier: 3 },
  { id: 'jack', weight: 35, multiplier: 2 },
  { id: 'joker', weight: 5, multiplier: 15 },
  { id: 'crown', weight: 3, multiplier: 25 }
];

interface SpinResult {
  matrix: string[][];
  winAmount: number;
  isWin: boolean;
  winningLines: number[];
}

@Controller('games/royale-ace')
export class RoyaleAceController {

  @Post('spin')
  @HttpCode(HttpStatus.OK)
  async generateSpinResult(@Body() body: { betAmount: number }): Promise<SpinResult> {
    const { betAmount } = body;

    if (!betAmount || betAmount < 1) {
      throw new BadRequestException('Stake must be at least 1');
    }

    const cols = 5;
    const rows = 4;

    const matrix: string[][] = [];
    for (let c = 0; c < cols; c++) {
      const column: string[] = [];
      for (let r = 0; r < rows; r++) {
        column.push(this.getRandomSymbolId());
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
        const symbolConfig = SYMBOLS.find(s => s.id === firstSymbol);
        const payout = betAmount * (symbolConfig?.multiplier || 1) * (matchCount * 0.5);
        winAmount += payout;
        winningLines.push(r);
      }
    }

    return {
      matrix,
      winAmount,
      isWin: winAmount > 0,
      winningLines
    };
  }

  private getRandomSymbolId(): string {
    const totalWeight = SYMBOLS.reduce((sum, s) => sum + s.weight, 0);
    let random = Math.random() * totalWeight;
    for (const symbol of SYMBOLS) {
      if (random < symbol.weight) return symbol.id;
      random -= symbol.weight;
    }
    return SYMBOLS[0].id;
  }
}

