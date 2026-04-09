export class InvalidFileTypeError extends Error {
    constructor() {
        super("File type is not allowed");
        this.name = "InvalidFileTypeError";
    }
}

export class FileTooLargeError extends Error {
    constructor() {
        super("File exceeds maximum allowed size");
        this.name = "FileTooLargeError";
    }
}
