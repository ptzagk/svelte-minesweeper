import { BehaviorSubject, combineLatest, identity, merge } from 'rxjs';
import { filter, map, mapTo } from 'rxjs/operators';
import { makeMatrix } from '../helper';
import { Coordinate } from './coordinate.class';

export type FieldMark = 'flag' | 'questionMark' | undefined;

export interface Field {
	/**
	 * Implement only simple get logic
	 */
	getX(): number;
	/**
	 * Implement only simple get logic
	 */
	getY(): number;
	/**
	 * Implement only simple get logic
	 */
	getValue(): number;
	/**
	 * Implement only simple get logic
	 */
	getRevealed(): boolean;
	/**
	 * Implement only simple get logic
	 */
	getMark(): FieldMark;
	/**
	 * Implement only simple get logic
	 */
	getIsMine(): boolean;
	/**
	 * Implement only simple get logic
	 */
	getError(): boolean;
	/**
	 * Implement only simple set logic
	 */
	setValue(value: number): void;
	/**
	 * Implement only simple set logic
	 */
	setRevealed(revealed: boolean): void;
	/**
	 * Implement only simple set logic
	 */
	setMark(mark: FieldMark): void;
	/**
	 * Implement only simple set logic
	 */
	setIsMine(isMine: boolean): void;
	/**
	 * Implement only simple set logic
	 */
	setError(error: boolean): void;

	/**
	 *
	 * @param callback call this on left click
	 */
	registerOnReveal(callback: (isFlood?: boolean) => void): void;
	/**
	 *
	 * @param callback call this on right click
	 */
	registerOnMark(callback: (isFlood?: boolean) => void): void;
}

type FieldHolder<T> = {
	t: T;
	onReveal?: (isFlood?: boolean) => void;
};

export class MinesweeperGame<T extends Field = Field> {
	private matrix: FieldHolder<T>[][];
	private tileCount = this.width * this.height;

	private mines = new Map<string, Coordinate>();
	private mineCount = 10;

	private revealed$ = new BehaviorSubject<number>(0);
	private correctlyMarked$ = new BehaviorSubject<number>(0);
	private isBlown$ = new BehaviorSubject<FieldHolder<T> | undefined>(undefined);

	public isWon$ = this.revealed$.pipe(
		map((revealedCount) => revealedCount + this.mineCount === this.tileCount)
	);

	public isOnGoing$ = combineLatest([this.isWon$, this.isBlown$]).pipe(
		map(([isWon, isBlown]) => !isWon && !isBlown)
	);

	public isEnded$ = combineLatest([this.isWon$, this.isBlown$]).pipe(
		map(([isWon, isBlown]) => isWon || isBlown)
	);

	public gamestate$ = merge(
		this.isWon$.pipe(filter(identity), mapTo('won')),
		this.isBlown$.pipe(
			filter((isBlown) => !!isBlown),
			mapTo('lost')
		),
		this.isOnGoing$.pipe(filter(identity), mapTo('ongoing'))
	);

	public constructor(
		private readonly width: number,
		private readonly height: number = width,
		fieldAcquier: (x: number, y: number) => T
	) {
		this.matrix = makeMatrix(width, height, (x, y) => ({ t: fieldAcquier(x, y) }));

		this.reset();
	}

	public setMineCount(mineCount: number): void {
		this.mineCount = mineCount;
	}

	private isOutOfBounds(x: number, y: number): boolean {
		return x > this.width || y > this.height || x < 0 || y < 0;
	}

	private forEach(callback: (t: T, th: FieldHolder<T>) => void) {
		for (const row of this.matrix) {
			for (const th of row) {
				callback(th.t, th);
			}
		}
	}

	private surrounding(x: number, y: number): FieldHolder<T>[] {
		return Object.values(Coordinate.directions)
			.map((direction) => this.matrix[x + direction.x]?.[y + direction.y])
			.filter((th) => !!th);
	}

	public reset(): void {
		this.isBlown$.next(undefined);
		this.revealed$.next(0);
		this.correctlyMarked$.next(0);
		this.mines.clear();
		this.forEach((t, th) => {
			t.setValue(0);
			t.setIsMine(false);
			t.setMark(undefined);
			t.setError(false);
			t.setRevealed(false);
			t.registerOnReveal(() => {
				this.start(t.getX(), t.getY());
				th.onReveal?.(false);
			});
		});
	}

	/**
	 * Track the count of mine marks, and set the state of the mark
	 */
	private makeMarkLogic(t: T): () => void {
		return () => {
			if (t.getMark() === 'questionMark') {
				t.setMark(undefined);
			} else if (t.getMark() === 'flag') {
				t.setMark('questionMark');
				if (t.getIsMine()) this.correctlyMarked$.next(this.correctlyMarked$.value - 1);
			} else if (t.getMark() === undefined) {
				t.setMark('flag');
				if (t.getIsMine()) this.correctlyMarked$.next(this.correctlyMarked$.value + 1);
			}
		};
	}

	private makeMineRevealLogic(t: T, th: FieldHolder<T>): (isOriginalReveal?: boolean) => void {
		return (isOriginalReveal = true) => {
			if (isOriginalReveal && t.getMark() !== undefined) {
				t.setMark(undefined);
			} else {
				t.setError(true);
				this.isBlown$.next(th);
				this.forEach((tile) => {
					if (tile.getIsMine() && tile.getMark() !== 'flag') {
						tile.setRevealed(true);
					}

					if (!tile.getIsMine() && tile.getMark() === 'flag') {
						tile.setError(true);
					}
				});
			}
		};
	}

	/**
	 * Reveal the tile if not and count it
	 */
	private makeTileRevealLogic(t: T): (isOriginalReveal?: boolean) => void {
		return (isOriginalReveal = true) => {
			if (isOriginalReveal && t.getMark() !== undefined) {
				t.setMark(undefined);
			} else if (!t.getRevealed() && t.getMark() === undefined) {
				t.setRevealed(true);
				this.revealed$.next(this.revealed$.value + 1);

				if (!t.getValue()) {
					for (const tileHolder of this.surrounding(t.getX(), t.getY())) {
						if (tileHolder.t.getMark() === undefined) {
							tileHolder.onReveal?.(false);
						}
					}
				}
			}
		};
	}

	private start(startX: number, startY: number): void {
		if (this.isOutOfBounds(startX, startY)) {
			throw new Error('Start tile out of field');
		}

		// Reset the game
		this.reset();

		// Generate minefield
		while (this.mines.size < this.mineCount) {
			const coord = Coordinate.random(0, this.width, 0, this.height);
			if (!coord.equal(startX, startY)) {
				const th = this.matrix[coord.x][coord.y];
				th.t.setIsMine(true);
				this.mines.set(coord.toString(), coord);
			}
		}

		// Set values of the numbered tiles
		for (const [, mine] of this.mines) {
			for (const tileHolder of this.surrounding(mine.x, mine.y)) {
				if (tileHolder && !tileHolder.t.getIsMine()) {
					tileHolder.t.setValue(tileHolder.t.getValue() + 1);
				}
			}
		}

		// Register logic
		this.forEach((t, th) => {
			t.registerOnMark(this.makeMarkLogic(t));
			if (t.getIsMine()) {
				th.onReveal = this.makeMineRevealLogic(t, th);
			} else {
				th.onReveal = this.makeTileRevealLogic(t);
			}
			t.registerOnReveal(th.onReveal);
		});
	}
}
