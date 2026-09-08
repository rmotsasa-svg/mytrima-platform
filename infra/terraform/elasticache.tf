resource "aws_elasticache_subnet_group" "redis" {
  name       = "${var.project_name}-${var.environment}-redis"
  subnet_ids = data.aws_subnets.default.ids
}

resource "aws_elasticache_replication_group" "redis" {
  replication_group_id = "${var.project_name}-${var.environment}-redis"
  description          = "Mytrima ${var.environment} Redis cache"

  engine         = "redis"
  engine_version = "7.1"
  node_type      = var.redis_node_type

  # Single node, no read replicas — matches the pilot-scale sizing priced in
  # hosting-cost-comparison.md. num_cache_clusters=1 (not num_node_groups,
  # which is the cluster-mode-enabled path) is the correct argument for a
  # single-node non-cluster-mode replication group, confirmed against the
  # provider's own docs rather than assumed.
  num_cache_clusters = 1
  port               = 6379

  subnet_group_name  = aws_elasticache_subnet_group.redis.name
  security_group_ids = [aws_security_group.redis.id]

  # Master Plan Section 10: encryption at rest and in transit.
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  # "preferred" allows a client that can't yet speak TLS to still connect
  # (a no-downtime migration path) rather than hard-failing immediately.
  # Tighten to "required" once the app is confirmed connecting over TLS.
  transit_encryption_mode = "preferred"

  tags = local.common_tags
}
