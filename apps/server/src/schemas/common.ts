import { Type } from "@sinclair/typebox";

export const stringSchema = Type.String({
    minLength: 1,
    maxLength: 255,
    pattern: "^(?!\\s+$)[a-zA-Zа-яА-ЯёЁ0-9\\-',\"\. ]+$",
});

export const uriSchema = Type.String({
    format: "uri",
    pattern: `^${process.env.DOMAIN}/(api/static|files)/`,
});

export const idRouteParamsSchema = Type.Object({
    id: Type.String({
        format: "objectid",
        description: "ID",
        examples: ["673a4e2f1234567890abcdef"],
    }),
});

export const messageResponseSchema = Type.Object({ message: Type.String() });

export const unauthorizedErrorSchema = Type.Object({
    message: Type.Literal("Unauthorized"),
    error: Type.Literal("Unauthorized"),
    statusCode: Type.Literal(401),
});

export const badRequestErrorSchema = Type.Object({
    message: Type.String({
        description: "Error description",
    }),
    error: Type.Literal("Bad Request"),
    statusCode: Type.Literal(400),
});

export const notFoundErrorSchema = Type.Object({
    message: Type.String({
        description: "Error description",
    }),
    error: Type.Literal("Not Found"),
    statusCode: Type.Literal(404),
});

export const forbiddenErrorSchema = Type.Object({
    message: Type.Literal("Forbidden"),
    error: Type.Literal("Forbidden"),
    statusCode: Type.Literal(403),
});
