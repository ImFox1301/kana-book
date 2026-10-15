create table users (
    id            bigserial primary key,
    username      text        not null,
    password_hash text        not null,
    created_at    timestamptz not null default now()
);
create unique index users_username_lower on users (lower(username));

create table sessions (
    token_hash   bytea       primary key,
    user_id      bigint      not null references users (id) on delete cascade,
    created_at   timestamptz not null default now(),
    last_seen_at timestamptz not null default now(),
    expires_at   timestamptz not null
);
create index sessions_user on sessions (user_id);

-- Всё, что синхронизируется: слова, скрытые слова, образцы почерка, настройки, история ответов.
-- Конфликты решаются по updated_at (время изменения на устройстве, мс): побеждает более позднее.
create sequence items_seq;
create table items (
    user_id    bigint  not null references users (id) on delete cascade,
    collection text    not null,
    item_id    text    not null,
    data       jsonb,
    deleted    boolean not null default false,
    updated_at bigint  not null,
    seq        bigint  not null default nextval('items_seq'),
    primary key (user_id, collection, item_id)
);
create index items_user_seq on items (user_id, seq);
