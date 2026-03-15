locals {
  name_prefix = "${var.project}-${var.environment}"
  tags = {
    Project     = var.project
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

module "network" {
  source = "./modules/network"

  name_prefix          = local.name_prefix
  vpc_cidr             = var.vpc_cidr
  public_subnet_cidrs  = var.public_subnet_cidrs
  private_subnet_cidrs = var.private_subnet_cidrs
  tags                 = local.tags
}

module "eks" {
  source = "./modules/eks"

  name_prefix       = local.name_prefix
  vpc_id            = module.network.vpc_id
  private_subnet_ids = module.network.private_subnet_ids
  tags              = local.tags
}

module "rds" {
  source = "./modules/rds"

  name_prefix        = local.name_prefix
  vpc_id             = module.network.vpc_id
  private_subnet_ids = module.network.private_subnet_ids
  db_instance_class  = var.db_instance_class
  db_username        = var.db_username
  db_password        = var.db_password
  tags               = local.tags
}

module "redis" {
  source = "./modules/redis"

  name_prefix        = local.name_prefix
  vpc_id             = module.network.vpc_id
  private_subnet_ids = module.network.private_subnet_ids
  node_type          = var.redis_node_type
  tags               = local.tags
}

module "opensearch" {
  source = "./modules/opensearch"

  name_prefix        = local.name_prefix
  vpc_id             = module.network.vpc_id
  private_subnet_ids = module.network.private_subnet_ids
  instance_type      = var.opensearch_instance_type
  tags               = local.tags
}

module "kafka" {
  source = "./modules/kafka"

  name_prefix        = local.name_prefix
  vpc_id             = module.network.vpc_id
  private_subnet_ids = module.network.private_subnet_ids
  tags               = local.tags
}

module "object_storage" {
  source = "./modules/object-storage"

  name_prefix = local.name_prefix
  tags        = local.tags
}
