#--kind python:default
#--web true
# Note: this timeout is 5 minutes - 10 minutes is max allowed
#--timeout 300000
import types, os, work_areas

builder = []
## build-context ##
#--param REDIS_URL "$REDIS_URL"
#--param REDIS_PREFIX "$REDIS_PREFIX"
import redis
def init_redis(args, ctx):
  ctx.REDIS = redis.from_url(args.get("REDIS_URL", os.getenv("REDIS_URL")), decode_responses=True)
  ctx.REDIS_PREFIX = args.get("REDIS_PREFIX", os.getenv("REDIS_PREFIX"))
builder.append(init_redis)
#--param POSTGRES_URL "$POSTGRES_URL"
import psycopg
def init_postgresql(args, ctx):
  dburl = args.get("POSTGRES_URL", os.getenv("POSTGRES_URL"))
  ctx.POSTGRESQL = psycopg.connect(dburl)
builder.append(init_postgresql)

def main(args):
  try:
    ctx = types.SimpleNamespace()
    for fn in builder: fn(args, ctx)
    return { "body": work_areas.main(args, ctx=ctx) }
  except Exception as e:
    import traceback
    traceback.print_exc()
    return {
      "body": {"error": str(e) },
      "statusCode": 500
    }
