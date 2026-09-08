/**
 * DELIBERATE SIMPLIFICATION: uses the AWS account's existing default VPC
 * and default subnets rather than provisioning a dedicated one. Per Master
 * Plan Section 2 ("right-size before scale") and Section 3's own Stage 1
 * topology ("single region, single app instance"), building dedicated
 * networking for a 5-10 tenant pilot — before any app-hosting compute
 * resource is even defined — is complexity ahead of an actual need.
 *
 * KNOWN GAP to revisit, not a permanent design: the security groups below
 * allow access from anywhere inside the default VPC's CIDR, because no
 * app-hosting resource (ECS/EC2/etc.) exists yet to scope them to
 * specifically. Once one does, replace `cidr_blocks = [...]` with
 * `security_groups = [aws_security_group.app.id]` (or equivalent) so only
 * the actual application can reach the database and cache — not everything
 * else that might ever run in the default VPC.
 */

data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

resource "aws_security_group" "postgres" {
  name        = "${var.project_name}-${var.environment}-postgres"
  description = "Allows Postgres (5432) from within the default VPC only — never from the public internet."
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "Postgres from within the VPC"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = [data.aws_vpc.default.cidr_block]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = local.common_tags
}

resource "aws_security_group" "redis" {
  name        = "${var.project_name}-${var.environment}-redis"
  description = "Allows Redis (6379) from within the default VPC only — never from the public internet."
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "Redis from within the VPC"
    from_port   = 6379
    to_port     = 6379
    protocol    = "tcp"
    cidr_blocks = [data.aws_vpc.default.cidr_block]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = local.common_tags
}
