import { Effect } from "effect";

const BITS = 8192;
const CHUNK_SIZE = 32_768;

/** A negative answer is exact; candidates still require the original literal scanner. */
export class ReviewSourceLiteralIndex {
	private readonly buckets = new Uint32Array(BITS / 32);

	add(content: string, start: number, end: number): void {
		for (let offset = start; offset < Math.min(end, content.length - 2); offset++) {
			this.mark(bucket(content, offset, 31));
			this.mark(bucket(content, offset, 131));
		}
	}

	mayContain(query: string): boolean {
		for (let offset = 0; offset < query.length - 2; offset++) {
			if (!this.contains(bucket(query, offset, 31))) return false;
			if (!this.contains(bucket(query, offset, 131))) return false;
		}
		return true;
	}

	private mark(bit: number): void {
		this.buckets[bit >>> 5]! |= 1 << (bit & 31);
	}

	private contains(bit: number): boolean {
		return (this.buckets[bit >>> 5]! & (1 << (bit & 31))) !== 0;
	}
}

/** Index all original UTF16 units, yielding so deadlines can interrupt large files. */
export function indexReviewSourceLiteral(content: string): Effect.Effect<ReviewSourceLiteralIndex> {
	return Effect.gen(function* () {
		const index = new ReviewSourceLiteralIndex();
		for (let start = 0; start < content.length; start += CHUNK_SIZE) {
			yield* Effect.sync(() => index.add(content, start, start + CHUNK_SIZE));
			yield* Effect.yieldNow;
		}
		return index;
	});
}

function bucket(content: string, offset: number, multiplier: number): number {
	return (
		(Math.imul(
			Math.imul(content.charCodeAt(offset), multiplier) + content.charCodeAt(offset + 1),
			multiplier,
		) +
			content.charCodeAt(offset + 2)) &
		(BITS - 1)
	);
}
