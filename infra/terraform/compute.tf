/**
 * The app-hosting compute network.tf's own comment flagged as missing —
 * "no app-hosting resource (ECS/EC2/etc.) exists yet." A single EC2
 * instance, matching this project's own already-stated Stage 1 topology
 * ("single region, single app instance," rds.tf's own comment) rather
 * than standing up an ECS cluster/task definitions/ECR repo a 5-10 tenant
 * pilot doesn't need yet — same "right-size before scale" reasoning as
 * this whole directory's other resources.
 *
 * NOT YET APPLIED — same status as every other resource in this
 * directory (see main.tf's own top comment).
 *
 * DELIBERATELY OUT OF SCOPE HERE, same "don't invent a decision that
 * isn't this configuration's to make" discipline as elsewhere in this
 * directory:
 *   - HOW a specific build actually gets onto this instance (an image
 *     pushed to ECR and pulled by a deploy script, a CI job that scp's a
 *     build and restarts a systemd unit, etc.) — this resource provisions
 *     a real, running instance with Docker installed and reachable, not a
 *     specific deployed application. That's a real decision for whoever
 *     runs the first `apply`, not one to guess at here.
 *   - TLS termination / a real domain — no ACM certificate or Route53
 *     record exists yet because no domain name has been confirmed
 *     anywhere in this project. Add both once one is.
 */

# Amazon Linux 2023, arm64 — matches the Graviton (t4g) family already
# used for db.t4g.micro/cache.t4g.micro elsewhere in this directory, and
# ships with the SSM agent preinstalled (no extra bootstrap needed for
# the instance profile below to actually grant shell access).
data "aws_ami" "amazon_linux_arm64" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-*-arm64"]
  }

  filter {
    name   = "architecture"
    values = ["arm64"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# SSM Session Manager, not SSH — real shell access without ever opening
# port 22 to anything, matching the same "never publicly accessible where
# it doesn't have to be" posture as the Postgres/Redis security groups
# below. Requires only the SSM agent (preinstalled on the AMI above) and
# this instance role; no bastion host, no key pair to manage or leak.
data "aws_iam_policy_document" "app_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "app" {
  name               = "${var.project_name}-${var.environment}-app"
  assume_role_policy = data.aws_iam_policy_document.app_assume_role.json
  tags               = local.common_tags
}

resource "aws_iam_role_policy_attachment" "app_ssm" {
  role       = aws_iam_role.app.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "app" {
  name = "${var.project_name}-${var.environment}-app"
  role = aws_iam_role.app.name
}

resource "aws_instance" "app" {
  ami                    = data.aws_ami.amazon_linux_arm64.id
  instance_type          = var.app_instance_type
  subnet_id              = data.aws_subnets.default.ids[0]
  vpc_security_group_ids = [aws_security_group.app.id]
  iam_instance_profile   = aws_iam_instance_profile.app.name

  # Installs Docker and leaves it running — the one generic, safe-to-assume
  # step regardless of what actually gets deployed here. Does NOT pull or
  # run any application image — see this file's own top comment on why
  # that's deliberately not decided here.
  user_data = <<-EOT
    #!/bin/bash
    dnf install -y docker
    systemctl enable --now docker
  EOT

  # Real disk, not the AMI's own tiny default — enough for a handful of
  # Docker image layers plus normal OS overhead at pilot scale.
  root_block_device {
    volume_type = "gp3"
    volume_size = 20
    encrypted   = true
  }

  tags = merge(local.common_tags, { Name = "${var.project_name}-${var.environment}-app" })
}

# A stable public address survives this instance being replaced (a new
# AMI, a resize) without every DNS record/webhook callback URL that
# points at it needing to change too. Free while attached to a running
# instance — only unattached/idle EIPs are billed.
resource "aws_eip" "app" {
  instance = aws_instance.app.id
  domain   = "vpc"
  tags     = local.common_tags
}

resource "aws_security_group" "app" {
  name        = "${var.project_name}-${var.environment}-app"
  description = "The app instance's own security group - Postgres/Redis below are scoped to reference this directly, not the whole default VPC CIDR."
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "HTTP - real traffic redirects to HTTPS once a domain/cert exist; kept open now for the ACME HTTP-01 challenge that will need it"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # Deliberately no port 22 ingress rule at all — shell access is via SSM
  # Session Manager (the instance role above), which needs no open port.

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = local.common_tags
}
