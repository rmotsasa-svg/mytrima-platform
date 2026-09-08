resource "aws_db_subnet_group" "postgres" {
  name       = "${var.project_name}-${var.environment}-postgres"
  subnet_ids = data.aws_subnets.default.ids
  tags       = local.common_tags
}

resource "aws_db_instance" "postgres" {
  identifier     = "${var.project_name}-${var.environment}-postgres"
  engine         = "postgres"
  engine_version = "16" # unpinned minor — AWS picks the latest supported 16.x; pin a specific minor once a real upgrade policy exists
  instance_class = var.db_instance_class

  allocated_storage = var.db_allocated_storage_gb
  storage_type      = "gp3"
  storage_encrypted = true # Master Plan Section 10: encryption at rest

  db_name  = "mytrima"
  username = "mytrima_admin"
  # Master Plan Section 10: "Secrets... held in a dedicated secrets manager
  # — never in source control or plain environment files." RDS creates and
  # manages the master password in AWS Secrets Manager itself (confirmed
  # against the provider's own docs) — no password is ever set, seen, or
  # stored by Terraform, this repo, or its state file.
  manage_master_user_password = true

  db_subnet_group_name   = aws_db_subnet_group.postgres.name
  vpc_security_group_ids = [aws_security_group.postgres.id]
  publicly_accessible    = false

  # Pilot-stage choices, per Master Plan Section 3's own Stage 1 posture
  # ("single region, single app instance... no automatic failover") —
  # revisit at Stage 2 growth, not before:
  multi_az                = false
  backup_retention_period = 7

  # PILOT-ONLY, revisit before this holds anything that isn't test data:
  # skip_final_snapshot and deletion_protection=false make this instance
  # trivial to tear down during early iteration, at the direct cost of easy
  # accidental data loss. Flip both to their safer values (false / true)
  # before any real tenant's data lands here.
  skip_final_snapshot = true
  deletion_protection = false

  tags = local.common_tags
}
