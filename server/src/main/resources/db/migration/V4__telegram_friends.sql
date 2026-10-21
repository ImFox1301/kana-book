-- Вход через Telegram-бота и привязка телефона.
-- Номер приходит только кнопкой «Поделиться номером» — Telegram подтверждает, что он принадлежит этому пользователю.
alter table users add column tg_id bigint unique;
alter table users add column tg_username text;
alter table users add column phone text;

-- Попытка входа или привязки: приложение создаёт её и открывает бота по ссылке t.me/<бот>?start=<nonce>,
-- бот отмечает результат, приложение узнаёт его по nonce и секрету (секрет есть только у того браузера).
create table tg_logins (
    nonce          text        primary key,
    secret_hash    bytea       not null,
    kind           text        not null,            -- login | link
    user_id        bigint      references users (id) on delete cascade,   -- для link: кого привязываем
    tg_id          bigint,
    status         text        not null default 'new',   -- new | need_contact | confirm | approved | denied | error | done
    message        text,
    result_user_id bigint      references users (id) on delete cascade,
    created_at     timestamptz not null default now()
);
create index tg_logins_tg on tg_logins (tg_id);

-- Друзья: пара хранится один раз (a < b)
create table friends (
    a          bigint      not null references users (id) on delete cascade,
    b          bigint      not null references users (id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (a, b),
    check (a < b)
);
create index friends_b on friends (b);

create table friend_requests (
    from_id    bigint      not null references users (id) on delete cascade,
    to_id      bigint      not null references users (id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (from_id, to_id)
);
create index friend_requests_to on friend_requests (to_id);

-- Ссылка-приглашение: одноразовая, на 7 дней; в базе — только хеш
create table friend_invites (
    token_hash bytea       primary key,
    user_id    bigint      not null references users (id) on delete cascade,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null
);
create index friend_invites_user on friend_invites (user_id);
