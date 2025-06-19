// bot.ts
import { config } from "dotenv";
config();

import { Client, Events, GatewayIntentBits } from "discord.js";
import {
    AudioPlayerStatus,
    createAudioPlayer,
    createAudioResource,
    joinVoiceChannel,
    StreamType,
    VoiceConnection,
} from "@discordjs/voice";
import { request } from "https";
import { PassThrough } from "stream";
import { createWriteStream } from "fs";
import { finished } from "stream/promises";

const DISCORD_TOKEN = process.env.DISCORD_TOKEN!;
const VOICE_BOX_API_TOKEN = process.env.VOICE_BOX_API_TOKEN!;
const ALLOWED_CHANNEL_ID = process.env.CHANNEL_ID;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
    ],
});

const userSpeakerMap = new Map<string, number>();
const channelUserMap = new Map<string, Set<string>>();
const voiceConnections = new Map<string, VoiceConnection>();

client.once(Events.ClientReady, (c) => {
    console.log(`✅ Logged in as ${c.user.tag}`);
});

client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;
    if (ALLOWED_CHANNEL_ID && message.channel.id !== ALLOWED_CHANNEL_ID) return;

    const userId = message.author.id;
    const voiceChannel = message.member?.voice?.channel;
    const guildId = message.guildId;

    if (!guildId) return;

    if (message.content.startsWith("tts")) {
        if (message.content === "tts ls") {
            const apiUrl =
                `https://api.su-shiki.com/v2/voicevox/speakers/?key=${VOICE_BOX_API_TOKEN}`;
            get(apiUrl, (res) => {
                let data = "";
                res.on("data", (chunk) => (data += chunk));
                res.on("end", () => {
                    const speakers = JSON.parse(data);
                    let response = "```";
                    for (const speaker of speakers) {
                        response += `${speaker.name}:\n`;
                        for (const style of speaker.styles) {
                            response += `  ${style.name}: ${style.id}\n`;
                        }
                    }
                    response += "```";
                    message.channel.send(response);
                });
            }).on("error", (err) => {
                console.error(err);
                message.channel.send("❌ 話者リストの取得に失敗しました。");
            });
            return;
        }

        if (/^tts \d+$/.test(message.content)) {
            const id = parseInt(message.content.split(" ")[1]);
            userSpeakerMap.set(userId, id);
            await message.react("✅");
            if (voiceChannel) {
                if (!channelUserMap.has(voiceChannel.id)) {
                    const connection = joinVoiceChannel({
                        channelId: voiceChannel.id,
                        guildId: voiceChannel.guild.id,
                        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
                    });
                    voiceConnections.set(voiceChannel.id, connection);
                    channelUserMap.set(voiceChannel.id, new Set());
                }
                channelUserMap.get(voiceChannel.id)?.add(userId);
            }
            return;
        }

        if (message.content === "tts stop") {
            for (const [channelId, userSet] of channelUserMap.entries()) {
                if (userSet.has(userId)) {
                    userSet.delete(userId);
                    userSpeakerMap.delete(userId);
                    if (userSet.size === 0) {
                        voiceConnections.get(channelId)?.destroy();
                        voiceConnections.delete(channelId);
                        channelUserMap.delete(channelId);
                    }
                    await message.react("✅");
                    return;
                }
            }
            await message.reply("❌ あなたは登録されていません。");
            return;
        }
        return;
    }

    // 登録ユーザーの通常再生処理
    const speakerId = userSpeakerMap.get(userId);
    if (!speakerId) return;
    if (!voiceChannel) return;

    const connection = voiceConnections.get(voiceChannel.id);
    if (!connection) return;

    const playSegment = async () => {
        const text = message.content.replace(/\s+/g, " ").trim();
        const postData = `text=${
            encodeURIComponent(text)
        }&key=${VOICE_BOX_API_TOKEN}`;
        console.log(postData);
        const stream = new PassThrough();

        const options = {
            hostname: "api.su-shiki.com",
            path: `/v2/voicevox/audio/?speaker=${speakerId}`,
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
        };

        try {
            await new Promise((resolve) => {
                const req = request(options, (res) => {
                    if (res.statusCode !== 200) {
                        message.channel.send(
                            `❌ 音声取得に失敗しました: HTTP ${res.statusCode}`,
                        );
                        return resolve(null);
                    }

                    res.pipe(stream);

                    finished(res).then(() => {
                        console.log("✅ stream finished");
                        resolve(null);
                    });
                });

                req.on("error", (err) => {
                    console.error(err);
                    message.channel.send(
                        "❌ 音声取得時にエラーが発生しました。",
                    );
                    resolve(null);
                });
                req.write(postData);
                req.end();
            });

            const player = createAudioPlayer();
            const resource = createAudioResource(stream, {
                inputType: StreamType.Arbitrary,
            });

            connection.subscribe(player);
            player.play(resource);

            await new Promise((res) => {
                player.once(AudioPlayerStatus.Idle, res);
            });
        } catch (e) {
            console.error("TTS error:", e);
        }
    };
    await playSegment();
});

client.login(DISCORD_TOKEN);
