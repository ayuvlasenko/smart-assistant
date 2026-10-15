const codeKindDirectory =
    /(?:^|\/)(?:utils|constants|types|errors|helpers|schemas)\//;
const codeKindName = /-(?:types|constants|utils|helpers)\.[jt]s$/;
const typeDeclarations = new Set([
    "TSTypeAliasDeclaration",
    "TSInterfaceDeclaration",
    "TSModuleDeclaration",
]);
const functionInitializers = new Set([
    "ArrowFunctionExpression",
    "FunctionExpression",
]);

export default {
    meta: {
        type: "suggestion",
        docs: {
            description:
                "Keep the layout of a file: imports, declarations, the main export, then helpers in the order of first use",
        },
        schema: [],
        messages: {
            importAfterCode: "Move this import above the code of the file.",
            declarationAfterMain:
                "Move this declaration above the main export of the file.",
            defaultNotLast:
                "End a file that exports a class with its plugin, export default fp(...).",
            helperAboveCaller:
                "Move the helper {{name}} below its first caller.",
            codeKindFile:
                "Name the file after its abstraction, not after a kind of code such as types, constants or utils.",
        },
    },
    create(context) {
        return {
            Program(program) {
                const filename = context.filename.replaceAll("\\", "/");

                if (
                    codeKindDirectory.test(filename) ||
                    codeKindName.test(filename)
                ) {
                    context.report({
                        node: program,
                        messageId: "codeKindFile",
                    });
                }

                reportImportsAfterCode(context, program.body);
                reportDeclarationsAfterMain(context, program.body);
                reportDefaultNotLast(context, program.body);
                reportHelpersAboveCallers(context, program.body);
            },
        };
    },
};

function reportImportsAfterCode(context, body) {
    let hasCode = false;

    for (const node of body) {
        if (node.type !== "ImportDeclaration") {
            hasCode = true;
        } else if (hasCode) {
            context.report({ node, messageId: "importAfterCode" });
        }
    }
}

function reportDeclarationsAfterMain(context, body) {
    const mainIndex = findMainExport(body);

    if (mainIndex < 0) {
        return;
    }

    for (const node of body.slice(mainIndex + 1)) {
        if (isDeclaration(unwrapExport(node))) {
            context.report({ node, messageId: "declarationAfterMain" });
        }
    }
}

function findMainExport(body) {
    const namedIndex = body.findIndex(
        (node) =>
            node.type === "ExportNamedDeclaration" &&
            (node.declaration?.type === "ClassDeclaration" ||
                node.declaration?.type === "FunctionDeclaration"),
    );

    return namedIndex >= 0
        ? namedIndex
        : body.findIndex((node) => node.type === "ExportDefaultDeclaration");
}

function isDeclaration(node) {
    if (typeDeclarations.has(node.type)) {
        return true;
    }

    return (
        node.type === "VariableDeclaration" &&
        node.declarations.some(
            (declaration) =>
                !functionInitializers.has(declaration.init?.type ?? ""),
        )
    );
}

function unwrapExport(node) {
    return node.type === "ExportNamedDeclaration" && node.declaration
        ? node.declaration
        : node;
}

function reportDefaultNotLast(context, body) {
    const hasClass = body.some(
        (node) => unwrapExport(node).type === "ClassDeclaration",
    );
    const defaultIndex = body.findIndex(
        (node) => node.type === "ExportDefaultDeclaration",
    );

    if (hasClass && defaultIndex >= 0 && defaultIndex !== body.length - 1) {
        context.report({
            node: body[defaultIndex],
            messageId: "defaultNotLast",
        });
    }
}

function reportHelpersAboveCallers(context, body) {
    for (const node of body) {
        if (node.type !== "FunctionDeclaration" || !node.id) {
            continue;
        }

        const [variable] = context.sourceCode.getDeclaredVariables(node);
        const callers = (variable?.references ?? []).filter(
            ({ identifier }) =>
                identifier.range[0] < node.range[0] ||
                identifier.range[0] > node.range[1],
        );

        if (
            callers.length &&
            callers.every(
                ({ identifier }) => identifier.range[0] > node.range[1],
            )
        ) {
            context.report({
                node: node.id,
                messageId: "helperAboveCaller",
                data: { name: node.id.name },
            });
        }
    }
}
