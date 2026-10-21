-- Push-напоминания. Подписка — на устройство (браузер), настройки — на пользователя.
create table push_subs (
    id         bigserial   primary key,
    user_id    bigint      not null references users (id) on delete cascade,
    endpoint   text        not null unique,
    p256dh     text        not null,
    auth       text        not null,
    created_at timestamptz not null default now()
);
create index push_subs_user on push_subs (user_id);

create table push_prefs (
    user_id   bigint  primary key references users (id) on delete cascade,
    enabled   boolean not null default true,
    remind_at text    not null default '19:00',   -- местное время ЧЧ:ММ
    tz        text    not null default 'Europe/Moscow',
    last_sent date                                -- местная дата последнего напоминания
);

-- служебные значения: ключи VAPID
create table kv (
    k text primary key,
    v text not null
);
