export class ReviewModelResponseError extends Error {
	constructor() {
		super("The review model returned an invalid response.");
	}
}
