const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
require('dotenv').config();

const TOKEN = process.env.DISCORD_TOKEN;

// ---------- DATABASE ----------
const db = new sqlite3.Database('bot_data.db');

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS panels (
        guild_id TEXT PRIMARY KEY,
        channel_id TEXT,
        message_id TEXT,
        title TEXT,
        description TEXT,
        script_content TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS hosted_scripts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT,
        script_name TEXT,
        script_content TEXT,
        created_by TEXT,
        created_at TEXT,
        views INTEGER DEFAULT 0
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS whitelist (
        guild_id TEXT,
        user_id TEXT,
        expires_at TEXT,
        PRIMARY KEY (guild_id, user_id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS keys (
        key_code TEXT PRIMARY KEY,
        guild_id TEXT,
        created_by TEXT,
        created_at TEXT,
        expires_at TEXT,
        used_by TEXT,
        used_at TEXT,
        status TEXT DEFAULT 'active'
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS tickets (
        ticket_id TEXT PRIMARY KEY,
        guild_id TEXT,
        user_id TEXT,
        channel_id TEXT,
        created_at TEXT,
        status TEXT DEFAULT 'open'
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS mutes (
        guild_id TEXT,
        user_id TEXT,
        expires_at TEXT,
        PRIMARY KEY (guild_id, user_id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS support_config (
        guild_id TEXT PRIMARY KEY,
        category_id TEXT,
        support_role_id TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS panel_roles (
        guild_id TEXT,
        role_id TEXT,
        PRIMARY KEY (guild_id, role_id)
    )`);
});

// ---------- BOT ----------
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

const rest = new REST({ version: '10' }).setToken(TOKEN);

// ---------- HELPERS ----------
function isAdmin(interaction) {
    return interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);
}

function generateKey(length = 16) {
    return crypto.randomBytes(length).toString('hex').toUpperCase();
}

// ---------- COMMANDS ----------
const commands = [
    new SlashCommandBuilder()
        .setName('panel')
        .setDescription('Create a Source Panel in the current channel')
        .addStringOption(opt => opt.setName('title').setDescription('Panel title').setRequired(true))
        .addStringOption(opt => opt.setName('description').setDescription('Panel description').setRequired(true)),

    new SlashCommandBuilder()
        .setName('hostscript')
        .setDescription('Host a script for users to view')
        .addStringOption(opt => opt.setName('name').setDescription('Script name').setRequired(true))
        .addStringOption(opt => opt.setName('script').setDescription('Script content (loadstring)').setRequired(true)),

    new SlashCommandBuilder()
        .setName('generatekey')
        .setDescription('Generate a key for a user')
        .addUserOption(opt => opt.setName('user').setDescription('User to generate key for').setRequired(true))
        .addIntegerOption(opt => opt.setName('days').setDescription('Days until expiry'))
        .addBooleanOption(opt => opt.setName('lifetime').setDescription('Lifetime key')),

    new SlashCommandBuilder()
        .setName('whitelist')
        .setDescription('Whitelist a user')
        .addUserOption(opt => opt.setName('user').setDescription('User to whitelist').setRequired(true))
        .addIntegerOption(opt => opt.setName('days').setDescription('Days to whitelist').setRequired(true)),

    new SlashCommandBuilder()
        .setName('resethwid')
        .setDescription('Reset HWID for a user')
        .addUserOption(opt => opt.setName('user').setDescription('User to reset').setRequired(true)),

    new SlashCommandBuilder()
        .setName('setup-tickets')
        .setDescription('Setup support ticket system')
        .addRoleOption(opt => opt.setName('support_role').setDescription('Support role').setRequired(true)),

    new SlashCommandBuilder()
        .setName('mute')
        .setDescription('Timeout a user and delete their tickets')
        .addUserOption(opt => opt.setName('user').setDescription('User to mute').setRequired(true))
        .addIntegerOption(opt => opt.setName('minutes').setDescription('Minutes to mute').setRequired(true)),

    new SlashCommandBuilder()
        .setName('setpanelrole')
        .setDescription('Set the role users get when they redeem a key')
        .addRoleOption(opt => opt.setName('role').setDescription('Role to give').setRequired(true)),
];

// ---------- REGISTER COMMANDS ----------
async function registerCommands() {
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands.map(cmd => cmd.toJSON()) });
        console.log('✅ Commands registered!');
    } catch (err) {
        console.error('❌ Failed to register commands:', err);
    }
}

// ---------- EVENT: READY ----------
client.once('ready', async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
    await registerCommands();
});

// ---------- EVENT: INTERACTION ----------
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand()) return;

    const { commandName } = interaction;

    // ---------- /panel ----------
    if (commandName === 'panel') {
        if (!isAdmin(interaction)) {
            return interaction.reply({ content: '❌ You need Administrator permission.', ephemeral: true });
        }

        const title = interaction.options.getString('title');
        const description = interaction.options.getString('description');

        // Get the role configured for this server
        db.get(`SELECT role_id FROM panel_roles WHERE guild_id = ?`, [interaction.guildId], async (err, roleRow) => {
            const roleMention = roleRow ? `<@&${roleRow.role_id}>` : '@Source Access';

            // Create the Source Panel embed like in your image
            const embed = new EmbedBuilder()
                .setTitle(`# ${title}`)
                .setColor(0x2B2D31)
                .setDescription(
                    `${description}\n\n` +
                    `**How to Redeem**\n` +
                    `1. Click **Redeem Key**\n` +
                    `2. Paste your key and confirm\n` +
                    `3. Claim your ${roleMention} role\n\n` +
                    `Need help? Create a ticket.`
                )
                .setFooter({ text: `${interaction.guild.name} | ${interaction.user.username}` });

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('redeem_key')
                        .setLabel('🔑 Redeem Key')
                        .setStyle(ButtonStyle.Success)
                );

            const msg = await interaction.channel.send({ 
                embeds: [embed], 
                components: [row] 
            });

            db.run(`INSERT OR REPLACE INTO panels (guild_id, channel_id, message_id, title, description)
                    VALUES (?, ?, ?, ?, ?)`,
                [interaction.guildId, interaction.channelId, msg.id, title, description]);

            await interaction.reply({ content: '✅ Source Panel created successfully!', ephemeral: true });
        });
    }

    // ---------- /setpanelrole ----------
    if (commandName === 'setpanelrole') {
        if (!isAdmin(interaction)) {
            return interaction.reply({ content: '❌ You need Administrator permission.', ephemeral: true });
        }

        const role = interaction.options.getRole('role');

        db.run(`INSERT OR REPLACE INTO panel_roles (guild_id, role_id) VALUES (?, ?)`,
            [interaction.guildId, role.id]);

        await interaction.reply({ 
            content: `✅ Panel role set to ${role}! Users will get this role when they redeem a key.`, 
            ephemeral: true 
        });
    }

    // ---------- /hostscript ----------
    if (commandName === 'hostscript') {
        if (!isAdmin(interaction)) {
            return interaction.reply({ content: '❌ You need Administrator permission.', ephemeral: true });
        }

        const name = interaction.options.getString('name');
        const script = interaction.options.getString('script');

        db.run(`INSERT INTO hosted_scripts (guild_id, script_name, script_content, created_by, created_at)
                VALUES (?, ?, ?, ?, ?)`,
            [interaction.guildId, name, script, interaction.user.id, new Date().toISOString()]);

        const embed = new EmbedBuilder()
            .setTitle(`📜 ${name}`)
            .setDescription('Click the button below to copy the script')
            .setColor(0x00FF00)
            .addFields({ 
                name: '📋 Script', 
                value: `\`\`\`lua\n${script.substring(0, 500)}${script.length > 500 ? '...' : ''}\n\`\`\``,
                inline: false 
            })
            .setFooter({ text: `Hosted by ${interaction.user.username}` });

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`copy_script_${Date.now()}`)
                    .setLabel('📋 Tap to Copy')
                    .setStyle(ButtonStyle.Secondary)
            );

        await interaction.channel.send({ embeds: [embed], components: [row] });
        await interaction.reply({ content: `✅ Script "${name}" hosted successfully!`, ephemeral: true });
    }

    // ---------- /generatekey ----------
    if (commandName === 'generatekey') {
        if (!isAdmin(interaction)) {
            return interaction.reply({ content: '❌ You need Administrator permission.', ephemeral: true });
        }

        const user = interaction.options.getUser('user');
        const days = interaction.options.getInteger('days') || 30;
        const lifetime = interaction.options.getBoolean('lifetime') || false;

        const key = generateKey();
        const expires = new Date();
        if (!lifetime) expires.setDate(expires.getDate() + days);

        db.run(`INSERT INTO keys (key_code, guild_id, created_by, created_at, expires_at, status)
                VALUES (?, ?, ?, ?, ?, ?)`,
            [key, interaction.guildId, interaction.user.id, new Date().toISOString(), 
             lifetime ? null : expires.toISOString(), 'active']);

        const embed = new EmbedBuilder()
            .setTitle('🔑 Key Generated')
            .setColor(0x00FF00)
            .addFields(
                { name: 'User', value: user.toString(), inline: true },
                { name: 'Key', value: `\`${key}\``, inline: true },
                { name: 'Expires', value: lifetime ? 'Never (Lifetime)' : expires.toLocaleDateString(), inline: true }
            );

        try {
            await user.send({ embeds: [embed] });
            await interaction.reply({ content: `✅ Key sent to ${user}!`, ephemeral: true });
        } catch {
            await interaction.reply({ embeds: [embed] });
        }
    }

    // ---------- /whitelist ----------
    if (commandName === 'whitelist') {
        if (!isAdmin(interaction)) {
            return interaction.reply({ content: '❌ You need Administrator permission.', ephemeral: true });
        }

        const user = interaction.options.getUser('user');
        const days = interaction.options.getInteger('days');
        const expires = new Date();
        expires.setDate(expires.getDate() + days);

        db.run(`INSERT OR REPLACE INTO whitelist (guild_id, user_id, expires_at)
                VALUES (?, ?, ?)`,
            [interaction.guildId, user.id, expires.toISOString()]);

        await interaction.reply({ content: `✅ ${user} has been whitelisted for ${days} days!` });
    }

    // ---------- /resethwid ----------
    if (commandName === 'resethwid') {
        if (!isAdmin(interaction)) {
            return interaction.reply({ content: '❌ You need Administrator permission.', ephemeral: true });
        }

        const user = interaction.options.getUser('user');
        await interaction.reply({ content: `✅ HWID reset for ${user}!` });
    }

    // ---------- /setup-tickets ----------
    if (commandName === 'setup-tickets') {
        if (!isAdmin(interaction)) {
            return interaction.reply({ content: '❌ You need Administrator permission.', ephemeral: true });
        }

        const supportRole = interaction.options.getRole('support_role');

        const category = await interaction.guild.channels.create({
            name: '🎫 Tickets',
            type: 4
        });

        db.run(`INSERT OR REPLACE INTO support_config (guild_id, category_id, support_role_id)
                VALUES (?, ?, ?)`,
            [interaction.guildId, category.id, supportRole.id]);

        const channel = await interaction.guild.channels.create({
            name: 'create-ticket',
            type: 0,
            parent: category.id
        });

        const embed = new EmbedBuilder()
            .setTitle('🎫 Support Tickets')
            .setDescription('Click the button below to create a support ticket!')
            .setColor(0x5865F2);

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('create_ticket')
                    .setLabel('🎫 Create Ticket')
                    .setStyle(ButtonStyle.Success)
            );

        await channel.send({ embeds: [embed], components: [row] });
        await interaction.reply({ content: `✅ Ticket system setup complete!`, ephemeral: true });
    }

    // ---------- /mute ----------
    if (commandName === 'mute') {
        if (!isAdmin(interaction)) {
            return interaction.reply({ content: '❌ You need Administrator permission.', ephemeral: true });
        }

        const user = interaction.options.getUser('user');
        const minutes = interaction.options.getInteger('minutes');
        const member = interaction.guild.members.cache.get(user.id);

        if (!member) {
            return interaction.reply({ content: '❌ User not found!', ephemeral: true });
        }

        const duration = minutes * 60 * 1000;
        await member.timeout(duration, `Muted by ${interaction.user.tag}`);

        db.all(`SELECT channel_id FROM tickets WHERE guild_id = ? AND user_id = ? AND status = 'open'`,
            [interaction.guildId, user.id],
            async (err, rows) => {
                if (rows) {
                    for (const row of rows) {
                        const channel = interaction.guild.channels.cache.get(row.channel_id);
                        if (channel) await channel.delete();
                    }
                    db.run(`UPDATE tickets SET status = 'closed' WHERE guild_id = ? AND user_id = ?`,
                        [interaction.guildId, user.id]);
                }
            }
        );

        db.run(`INSERT OR REPLACE INTO mutes (guild_id, user_id, expires_at)
                VALUES (?, ?, ?)`,
            [interaction.guildId, user.id, new Date(Date.now() + duration).toISOString()]);

        await interaction.reply({ content: `✅ ${user} has been muted for ${minutes} minutes and their tickets deleted!` });
    }
});

// ---------- BUTTON HANDLERS ----------
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;

    // Redeem Key Button
    if (interaction.customId === 'redeem_key') {
        const modal = new ModalBuilder()
            .setCustomId('redeem_modal')
            .setTitle('🔑 Redeem Key');

        const keyInput = new TextInputBuilder()
            .setCustomId('key_input')
            .setLabel('Enter your key')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('XXXX-XXXX-XXXX-XXXX')
            .setRequired(true);

        const row = new ActionRowBuilder().addComponents(keyInput);
        modal.addComponents(row);

        await interaction.showModal(modal);
    }

    // Create Ticket Button
    if (interaction.customId === 'create_ticket') {
        db.get(`SELECT category_id, support_role_id FROM support_config WHERE guild_id = ?`,
            [interaction.guildId],
            async (err, config) => {
                if (!config) {
                    return interaction.reply({ content: '❌ Ticket system not configured!', ephemeral: true });
                }

                const ticketId = 'ticket-' + Date.now().toString(36);
                const category = interaction.guild.channels.cache.get(config.category_id);

                const channel = await interaction.guild.channels.create({
                    name: ticketId,
                    type: 0,
                    parent: category ? category.id : null,
                    permissionOverwrites: [
                        { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                        { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                        { id: config.support_role_id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
                    ]
                });

                db.run(`INSERT INTO tickets (ticket_id, guild_id, user_id, channel_id, created_at)
                        VALUES (?, ?, ?, ?, ?)`,
                    [ticketId, interaction.guildId, interaction.user.id, channel.id, new Date().toISOString()]);

                const embed = new EmbedBuilder()
                    .setTitle('🎫 Ticket Created')
                    .setDescription(`Support will be with you shortly.`)
                    .setColor(0x5865F2)
                    .addFields(
                        { name: 'Created by', value: interaction.user.toString() },
                        { name: 'Ticket ID', value: ticketId }
                    );

                const row = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('close_ticket')
                            .setLabel('🔒 Close Ticket')
                            .setStyle(ButtonStyle.Danger)
                    );

                await channel.send({ embeds: [embed], components: [row] });
                await interaction.reply({ content: `✅ Ticket created: ${channel}`, ephemeral: true });
            }
        );
    }

    // Close Ticket Button
    if (interaction.customId === 'close_ticket') {
        await interaction.reply({ content: '🔒 Closing ticket...', ephemeral: true });
        setTimeout(async () => {
            await interaction.channel.delete();
        }, 2000);
    }

    // Copy Script Button (tap to copy)
    if (interaction.customId && interaction.customId.startsWith('copy_script_')) {
        db.get(`SELECT script_content FROM hosted_scripts WHERE guild_id = ? ORDER BY id DESC LIMIT 1`,
            [interaction.guildId],
            async (err, row) => {
                if (row) {
                    await interaction.reply({ 
                        content: `✅ Script copied!\n\`\`\`lua\n${row.script_content}\n\`\`\``, 
                        ephemeral: true 
                    });
                } else {
                    await interaction.reply({ content: '❌ Script not found!', ephemeral: true });
                }
            }
        );
    }
});

// ---------- MODAL HANDLERS ----------
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isModalSubmit()) return;

    // Redeem Key Modal
    if (interaction.customId === 'redeem_modal') {
        const key = interaction.fields.getTextInputValue('key_input');
        
        db.get(`SELECT * FROM keys WHERE key_code = ? AND status = 'active'`,
            [key],
            async (err, row) => {
                if (row) {
                    // Check if expired
                    if (row.expires_at && new Date(row.expires_at) < new Date()) {
                        db.run(`UPDATE keys SET status = 'expired' WHERE key_code = ?`, [key]);
                        return interaction.reply({ content: '❌ This key has expired!', ephemeral: true });
                    }

                    // Mark as used
                    db.run(`UPDATE keys SET status = 'used', used_by = ?, used_at = ? WHERE key_code = ?`,
                        [interaction.user.id, new Date().toISOString(), key]);

                    // Whitelist the user
                    const expires = new Date();
                    expires.setDate(expires.getDate() + 30);
                    db.run(`INSERT OR REPLACE INTO whitelist (guild_id, user_id, expires_at)
                            VALUES (?, ?, ?)`,
                        [interaction.guildId, interaction.user.id, expires.toISOString()]);

                    // Give the role if configured
                    db.get(`SELECT role_id FROM panel_roles WHERE guild_id = ?`,
                        [interaction.guildId],
                        async (err, roleRow) => {
                            if (roleRow) {
                                try {
                                    const member = await interaction.guild.members.fetch(interaction.user.id);
                                    await member.roles.add(roleRow.role_id);
                                } catch (e) {
                                    console.log('Could not add role:', e);
                                }
                            }
                        }
                    );

                    await interaction.reply({ 
                        content: `✅ Key redeemed successfully! You have been whitelisted and given your role.`, 
                        ephemeral: true 
                    });
                } else {
                    await interaction.reply({ content: '❌ Invalid or already used key!', ephemeral: true });
                }
            }
        );
    }
});

// ---------- START ----------
client.login(TOKEN);
