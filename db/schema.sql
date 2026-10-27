CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  first_name VARCHAR(50) NOT NULL,
  last_name VARCHAR(50) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  password TEXT NOT NULL,
  phone TEXT,
  company TEXT,
  country TEXT,
  talent_domain TEXT,
  role VARCHAR(20) NOT NULL DEFAULT 'user',
  avatar TEXT NOT NULL DEFAULT (''),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT users_role_check CHECK (role IN ('admin', 'user', 'worker'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS categories (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(60) NOT NULL UNIQUE,
  icon LONGTEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS workers (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL UNIQUE,
  category_id INT UNSIGNED NOT NULL,
  gender VARCHAR(100) NOT NULL DEFAULT '',
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_by VARCHAR(20) NOT NULL,
  language VARCHAR(100) NOT NULL DEFAULT '',
  badge VARCHAR(100) NOT NULL DEFAULT '',
  rating DECIMAL(2, 1) NOT NULL DEFAULT 0,
  reviews_count INT UNSIGNED NOT NULL DEFAULT 0,
  location VARCHAR(255) NOT NULL DEFAULT '',
  date_of_birth DATE,
  marketplace_badges JSON NOT NULL DEFAULT (JSON_ARRAY()),
  about LONGTEXT NOT NULL,
  education JSON NOT NULL DEFAULT (JSON_ARRAY()),
  experience JSON NOT NULL DEFAULT (JSON_ARRAY()),
  skills JSON NOT NULL DEFAULT (JSON_ARRAY()),
  linked_profiles JSON NOT NULL DEFAULT (JSON_ARRAY()),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY workers_category_id_idx (category_id),
  KEY workers_status_idx (status),
  CONSTRAINT workers_user_id_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT workers_category_id_fk FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT,
  CONSTRAINT workers_status_check CHECK (status IN ('pending', 'approved', 'rejected', 'suspended', 'reject')),
  CONSTRAINT workers_created_by_check CHECK (created_by IN ('worker', 'admin')),
  CONSTRAINT workers_rating_check CHECK (rating BETWEEN 0 AND 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS work_samples (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  title TEXT NOT NULL,
  sub_title TEXT NOT NULL,
  tools JSON NOT NULL DEFAULT (JSON_ARRAY()),
  client_name TEXT NOT NULL,
  delivery_date DATE NOT NULL,
  project_type VARCHAR(10) NOT NULL,
  preview TEXT NOT NULL,
  seller_id INT UNSIGNED,
  created_by_user_id BIGINT UNSIGNED,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY work_samples_seller_id_idx (seller_id),
  KEY work_samples_created_by_user_id_idx (created_by_user_id),
  CONSTRAINT work_samples_seller_id_fk FOREIGN KEY (seller_id) REFERENCES workers(id) ON DELETE SET NULL,
  CONSTRAINT work_samples_created_by_user_id_fk FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT work_samples_project_type_check CHECK (project_type IN ('design', 'video'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reviews (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  worker_id INT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  rating TINYINT UNSIGNED NOT NULL,
  comment VARCHAR(2000) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY reviews_worker_user_unique (worker_id, user_id),
  KEY reviews_worker_id_idx (worker_id),
  KEY reviews_user_id_idx (user_id),
  CONSTRAINT reviews_worker_id_fk FOREIGN KEY (worker_id) REFERENCES workers(id) ON DELETE CASCADE,
  CONSTRAINT reviews_user_id_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT reviews_rating_check CHECK (rating BETWEEN 1 AND 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS blogs (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  title TEXT NOT NULL,
  subtitle TEXT NOT NULL,
  slug VARCHAR(100) NOT NULL UNIQUE,
  content LONGTEXT NOT NULL,
  category TEXT NOT NULL,
  author_name TEXT NOT NULL,
  author_role TEXT NOT NULL,
  author_avatar TEXT NOT NULL DEFAULT (''),
  image TEXT NOT NULL,
  comments_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS blog_comments (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  blog_id INT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  author_name TEXT NOT NULL,
  author_avatar TEXT NOT NULL DEFAULT (''),
  author_role TEXT NOT NULL,
  content VARCHAR(2000) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY blog_comments_blog_id_idx (blog_id),
  CONSTRAINT blog_comments_blog_id_fk FOREIGN KEY (blog_id) REFERENCES blogs(id) ON DELETE CASCADE,
  CONSTRAINT blog_comments_user_id_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS visitor_analytics (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  session_id VARCHAR(80) NOT NULL UNIQUE,
  first_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  page_views INT UNSIGNED NOT NULL DEFAULT 0,
  pages JSON NOT NULL DEFAULT (JSON_ARRAY()),
  browser VARCHAR(100) NOT NULL DEFAULT 'Unknown',
  operating_system VARCHAR(100) NOT NULL DEFAULT 'Unknown',
  device_type VARCHAR(100) NOT NULL DEFAULT 'Unknown',
  ip_address VARCHAR(45) NOT NULL DEFAULT '',
  language VARCHAR(40) NOT NULL DEFAULT '',
  languages JSON NOT NULL DEFAULT (JSON_ARRAY()),
  timezone VARCHAR(100) NOT NULL DEFAULT '',
  screen JSON NOT NULL DEFAULT (JSON_OBJECT('width', NULL, 'height', NULL, 'colorDepth', NULL)),
  viewport JSON NOT NULL DEFAULT (JSON_OBJECT('width', NULL, 'height', NULL)),
  platform VARCHAR(100) NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY visitor_analytics_last_seen_at_idx (last_seen_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
