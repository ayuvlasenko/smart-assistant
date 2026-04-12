import { ApiMethods, ApiResponse } from "@grammyjs/types";

type TelegramMethod = keyof ApiMethods<never>;
type TelegramMethodArgs<
    TMethod extends TelegramMethod,
    TUpload = never,
> = Parameters<ApiMethods<TUpload>[TMethod]>;
type TelegramMethodResult<TMethod extends TelegramMethod> = ReturnType<
    ApiMethods<never>[TMethod]
>;

export class TelegramApiService {
    private readonly baseUrl: string;

    constructor(botToken: string) {
        this.baseUrl = `https://api.telegram.org/bot${botToken}`;
    }

    getMe() {
        return this.call("getMe");
    }

    setWebhook(...args: TelegramMethodArgs<"setWebhook">) {
        return this.call("setWebhook", ...args);
    }

    sendMessage(...args: TelegramMethodArgs<"sendMessage">) {
        return this.call("sendMessage", ...args);
    }

    private async call<
        TFile = never,
        TMethod extends TelegramMethod = TelegramMethod,
    >(
        method: TMethod,
        ...args: TelegramMethodArgs<TMethod, TFile>
    ): Promise<ApiResponse<TelegramMethodResult<TMethod>>> {
        const [params] = args;
        const response = await fetch(`${this.baseUrl}/${method}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: params === undefined ? undefined : JSON.stringify(params),
        });

        return response.json() as Promise<
            ApiResponse<TelegramMethodResult<TMethod>>
        >;
    }
}
