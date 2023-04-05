import * as fs from 'fs';
import { ChatCompletionRequestMessageRoleEnum } from 'openai/dist/api';
import path from 'path';
import { Context, session, Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import { FilteredContext } from 'telegraf/src/context';
import { Update } from 'typegram';
import { OpenAiEngine, SessionMessage } from './open-ai';
import { ENV_VARS } from "./env";

const download = require('download');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path
const ffmpeg = require('fluent-ffmpeg')


// https://github.com/feathers-studio/telegraf-docs/blob/master/examples/session-bot.ts
interface SessionData {
    messages?: SessionMessage[];
}

// Define your own context type
interface MyContext extends Context<any> {
    session?: SessionData;
}

export class TelegramBotMessageHandler {
    private readonly bot = new Telegraf<MyContext>(ENV_VARS.TELEGRAM_TOKEN);
    private readonly openAi = new OpenAiEngine();
    private readonly allowedUserIds = ENV_VARS.USER_IDS;

    private readonly restrictedMessage = 'Sorry. You are not registered. Have a nice day!';

    private readonly startMessage = `
Hello. If you want to start a free conversation, just send a text or a voice message.
If you want to start teaching, type /teach
If you want to reset the conversation, type /reset
`;

    private readonly startTeach = `Let's talk`;
//     private readonly startTeach = `
// Hi, I will suggest a topic for conversation, and you will ask a question on it.
// Then check my answer for grammatical errors and offer the correct option.
// Then you ask the next question. Let's go!
// `;

    private readonly mediaDir = 'tmp-media';

    constructor() {
        this.bot.use(session());
        this.bot.settings(async ctx => {
            await ctx.telegram.setMyCommands([
                {
                    command: "/teach",
                    description: "Start conversation",
                },
                {
                    command: "/reset",
                    description: "Reset session",
                },
            ]);
        });
        this.bot.start(async (ctx) => {
            await this.doForAllowedUser(ctx as any, () => ctx.reply(this.startMessage));
        });
        this.bot.command('teach', async (ctx: MyContext) => {
            await this.doForAllowedUser(ctx, () => ctx.reply(this.startTeach));
        });
        this.bot.command('reset', (ctx) => {
            if (ctx.session) {
                ctx.session.messages = [];
            }
        });

        // @ts-ignore
        this.bot.on(message('text'), async (ctx: MyContext) => {
            await this.doForAllowedUser(ctx, () => this.onText(ctx));
        });
        // @ts-ignore
        this.bot.on(message('voice'), async (ctx: MyContext) => {
            await this.doForAllowedUser(ctx, () => this.onVoice(ctx))
        });

        this.bot.launch();

        ffmpeg.setFfmpegPath(ffmpegPath);
    }

    private async doForAllowedUser(ctx: MyContext, cb: (ctx: MyContext) => void) {
        if (!this.isAllowed(ctx)) {
            await ctx.reply(this.restrictedMessage);
            return;
        }

        await cb(ctx);
    }

    private addToSession<T extends keyof SessionData>(ctx: MyContext, key: T, value: SessionData[T]) {
        if (!ctx.session) {
            ctx.session = {};
        }

        ctx.session[key] = value;
    }

    private isAllowed(ctx: MyContext) {
        return this.allowedUserIds.includes(ctx.update.message.from.id);
    }

    private async onVoice(ctx: any) {
        const fileLink = await this.bot.telegram.getFileLink(ctx.update.message.voice.file_id);

        await download(fileLink.href, this.mediaDir);
        const filename = path.parse(fileLink.pathname).base;
        const filePath = `./${this.mediaDir}/${filename}`;
        const mp3filePath = `./${this.mediaDir}/${filename}`.replace('.oga', '.mp3');

        const outStream = fs.createWriteStream(mp3filePath);

        ffmpeg()
          .input(filePath)
          .audioQuality(96)
          .toFormat("mp3")
          .on('error', error => console.log(`Encoding Error: ${error.message}`))
          .on('exit', () => console.log('Audio recorder exited'))
          .on('close', () => console.log('Audio recorder closed'))
          .on('end', async () => {
              console.log('Audio Transcoding succeeded !');

              const stream = fs.createReadStream(mp3filePath);
              try {
                  // @ts-ignore
                  const response = await this.openAi.transcript(stream);
                  const text = response.data?.text || '';

                  await ctx.reply(`[Voice message]: ${text}`);

                  const mistakesResp = await this.openAi.chat([{
                      content: `Fix the sentence mistakes: ${text}`,
                      role: ChatCompletionRequestMessageRoleEnum.User,
                  }]);

                  const fixedText = mistakesResp.data.choices.map(choice => choice?.message?.content).join(" | ");

                  await ctx.reply(`[Fixed message]: ${fixedText}`);
                  await this.chat(ctx, text);
              } catch (error) {
                  console.log(error.response.data)
                  await ctx.reply(`[ERROR:Transcription] ${error.response.data.error.message}`);
              }

              this.deleteFile(filePath);
              this.deleteFile(mp3filePath);
          })
          .pipe(outStream, { end: true });

    }

    private deleteFile(filePath: string) {
        fs.unlink(filePath, (err) => {
            if (err) {
                throw err;
            }
        });
    }

    // private async onText(ctx: FilteredContext<MyContext, Extract<Update, 'Update.MessageUpdate'>>) {
    private async onText(ctx: MyContext) {
        await this.chat(ctx, ctx.update.message.text);
    }

    private async chat(ctx: any, userMessage: string) {
        const sessionMessages: SessionData['messages'] = [...ctx.session?.messages || []];

        sessionMessages.push({
            content: userMessage,
            role: ChatCompletionRequestMessageRoleEnum.User,
        });

        try {
            const response = await this.openAi.chat(sessionMessages);
            const text = response.data.choices.map(choice => choice?.message?.content).join(" | ");

            sessionMessages.push({
                content: text,
                role: ChatCompletionRequestMessageRoleEnum.Assistant,
            });

            if (!ctx.session) {
                ctx.session = {};
            }

            ctx.session.messages = sessionMessages;
            ctx.reply(text);
        } catch (error) {
            console.log(error.response.data);
            ctx.reply(`[ERROR:ChatGPT]: ${error.response.data.error.message}`);
        }
    }
}
