# Fixture: Ruby with various ENV access patterns

# Standard bracket access
database_url = ENV['DATABASE_URL']
secret_key = ENV["SECRET_KEY_BASE"]

# ENV.fetch with and without default
stripe_key = ENV.fetch('STRIPE_SECRET_KEY')
redis_url = ENV.fetch('REDIS_URL', 'redis://localhost:6379')

# ENV.dig (less common)
maybe_value = ENV.dig('OPTIONAL_VAR')

# In a class
class Config
  def self.stripe_key
    ENV['STRIPE_PUBLISHABLE_KEY']
  end

  def self.admin_email
    ENV.fetch('ADMIN_EMAIL')
  end
end

# In a Rails initializer style
if ENV['RAILS_ENV'] == 'production'
  config.force_ssl = true
end

# This should be skipped — it's commented out
# secret = ENV['COMMENTED_SECRET']

# Dynamic access — flagged as __DYNAMIC__
key = :SOME_SETTING
dynamic = ENV[key]
