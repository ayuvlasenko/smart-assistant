import multipart from "@fastify/multipart";
import { MAX_FILE_SIZE } from "../../constants/files.js";

export const autoConfig = {
    limits: {
        fieldNameSize: 100,
        fieldSize: 100,
        fields: 10,
        fileSize: Math.round(MAX_FILE_SIZE * 1.5),
        files: 1,
        parts: 1000,
    },
};

export default multipart;
