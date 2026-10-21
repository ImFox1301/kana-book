-- Фото профиля: небольшое изображение (приложение уменьшает до 256×256), версия — для кэша браузера
alter table users add column avatar bytea;
alter table users add column avatar_type text;
alter table users add column avatar_ver int not null default 0;
