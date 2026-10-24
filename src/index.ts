import { Client, Events, GatewayIntentBits, REST, Routes, TextChannel } from "discord.js";
import "dotenv/config";
import { checkCtftime, openDb } from "./ctftime.js";

const DB_PATH = "data/bot.sqlite";
const db = openDb(DB_PATH);

const GUILD_ID = "1021353479823962124";
const CHANNEL_ID = "1563080040042995722";

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

async function registerCommands() {
  const rest = new REST().setToken(process.env.DISCORD_TOKEN!);
  await rest.put(Routes.applicationGuildCommands(client.user!.id, GUILD_ID), {
    body: [
      { name: "ping", description: "Cek bot hidup" },
      { name: "ctf", description: "Cek CTFtime sekarang (force kirim ke channel)" },
    ],
  });
  console.log("✅ Slash commands registered");
}

client.once(Events.ClientReady, async (c) => {
  console.log(`✅ Bot ready! Logged in as ${c.user.tag}`);
  try {
    await registerCommands();
  } catch (err) {
    console.error("Failed to register commands:", err);
  }

  await runCheck();
  setInterval(() => {
    runCheck().catch((err) => console.error("ctftime loop error:", err));
  }, 30 * 60 * 1000);
});

async function getChannel(): Promise<TextChannel> {
  const ch = await client.channels.fetch(CHANNEL_ID);
  if (!ch || !(ch instanceof TextChannel)) throw new Error("Channel not found");
  return ch;
}

async function runCheck(force = false): Promise<number> {
  const channel = await getChannel();
  return checkCtftime(channel, db, force);
}

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === "ping") {
      await interaction.reply("Pong! 🏓");
    } else if (interaction.commandName === "ctf") {
      await interaction.deferReply();
      const n = await runCheck(true);
      await interaction.editReply(`✅ ${n} event CTF dikirim ke channel.`);
    }
  } catch (err) {
    console.error("interaction error:", err);
    if (interaction.deferred) {
      await interaction.editReply("❌ Terjadi error.");
    } else {
      await interaction.reply({ content: "❌ Terjadi error.", ephemeral: true });
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
