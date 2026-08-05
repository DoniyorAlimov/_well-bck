import express, { Request, Response } from "express";
import {
  RequestBody,
  RequestParams,
  RequestQuery,
  ResponseBody,
} from "../entities/RequestQuery";
import { normalizeDomainUsername } from "../lib/domainUsername";
import { requireAdmin } from "../middlewares/requireAdmin";
import { prisma } from "../prisma/client";
import { updateUserSchema, userSchema } from "../schemas";

const router = express.Router();

// Get list of users
router.get(
  "/",
  [requireAdmin],
  async (
    req: Request<RequestParams, ResponseBody, RequestBody, RequestQuery>,
    res: Response
  ) => {
    const { page, pageSize, searchedName } = req.query;

    const where = {
      username: {
        contains: searchedName,
      },
    };

    const orderBy = { username: "asc" } as const;

    const select = {
      id: true,
      username: true,
      domainUsername: true,
      isAdmin: true,
    };

    const count = (await prisma.user.findMany({ where })).length;

    const users =
      page && pageSize
        ? await prisma.user.findMany({
            where,
            orderBy,
            select,
            skip: (parseInt(page) - 1) * parseInt(pageSize),
            take: parseInt(pageSize),
          })
        : await prisma.user.findMany({
            orderBy,
            where,
            select,
          });

    res.send({
      count,
      page: parseInt(page),
      pageSize: parseInt(pageSize),
      results: users,
    });
  }
);

// Add a user by domain identity — no AD search, an admin types the domain
// identity string directly (e.g. "CONTOSO\jsmith"). No self-registration.
router.post("/", requireAdmin, async (req, res) => {
  const validation = userSchema.safeParse(req.body);
  if (!validation.success)
    return res.status(400).send(validation.error.format());

  const { username, domainUsername, isAdmin } = validation.data;

  const [domain, name] = domainUsername.split("\\");
  if (!domain || !name)
    return res
      .status(400)
      .send({ message: 'domainUsername must be in the form "DOMAIN\\username".' });

  const normalized = normalizeDomainUsername(domain, name);

  const existing = await prisma.user.findUnique({ where: { domainUsername: normalized } });
  if (existing)
    return res.status(400).send({ message: "User already registered." });

  const newUser = await prisma.user.create({
    data: {
      username,
      domainUsername: normalized,
      isAdmin,
    },
  });

  res.status(201).send(newUser);
});

// Update User
router.put("/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);

  const user = await prisma.user.findUnique({
    where: { id },
  });
  if (!user)
    return res
      .status(404)
      .send({ message: "The user with the given ID was not found." });

  const validation = updateUserSchema.safeParse(req.body);
  if (!validation.success)
    return res.status(400).send(validation.error.format());

  const { username, domainUsername, isAdmin } = validation.data;

  const [domain, name] = domainUsername.split("\\");
  if (!domain || !name)
    return res
      .status(400)
      .send({ message: 'domainUsername must be in the form "DOMAIN\\username".' });

  const normalized = normalizeDomainUsername(domain, name);

  const sameUser = await prisma.user.findFirst({
    where: { OR: [{ username }, { domainUsername: normalized }] },
  });

  if (sameUser && sameUser.id !== id)
    return res
      .status(400)
      .send({ message: "A user with this username or domain identity already exists." });

  const updatedUser = await prisma.user.update({
    where: { id },
    data: {
      username,
      domainUsername: normalized,
      isAdmin,
    },
  });

  res.send(updatedUser);
});

// Delete users
router.delete("/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);

  const user = await prisma.user.findUnique({
    where: { id },
  });
  if (!user)
    return res
      .status(404)
      .send({ message: "The user with the given ID was not found." });

  await prisma.user.delete({ where: { id } });

  res.send(user);
});

export default router;
