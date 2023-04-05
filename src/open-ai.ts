import { Configuration, OpenAIApi } from 'openai';
import { ChatCompletionRequestMessage } from 'openai/api';
import { ENV_VARS } from './env';

export type SessionMessage = ChatCompletionRequestMessage;

const configuration = new Configuration({
	apiKey: ENV_VARS.OPEN_AI_KEY,
});

export class OpenAiEngine {
	public readonly openai = new OpenAIApi(configuration);

	chat(messages: SessionMessage[]) {
		return this.openai.createChatCompletion({
			model: 'gpt-3.5-turbo-0301',
			messages,
		});
	}

	async transcript(file: File) {
		return this.openai.createTranscription(file, 'whisper-1', undefined, undefined, 0.2, 'en');
	}
}
