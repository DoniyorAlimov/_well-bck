import { normalizeDomainUsername } from "./lib/domainUsername";
import { prisma } from "./prisma/client";

// Example of command (quote the value if your shell treats \ specially):
// npm run create-superuser "domainUsername:CONTOSO\jsmith"

const args = process.argv.slice(2);

// Parse arguments into an object
const parsedArgs: { [key: string]: string } = {};

for (let arg of args) {
  const [key, value] = arg.split(":");
  parsedArgs[key] = value;
}

const domainUsernameArg = parsedArgs["domainUsername"];

const createSuperUser = async () => {
  if (!domainUsernameArg) {
    console.log('Usage: npm run create-superuser "domainUsername:DOMAIN\\username"');
    return;
  }

  const [domain, name] = domainUsernameArg.split("\\");
  if (!domain || !name) {
    console.log('domainUsername must be in the form "DOMAIN\\username".');
    return;
  }

  const domainUsername = normalizeDomainUsername(domain, name);

  try {
    const user = await prisma.user.findUnique({ where: { domainUsername } });

    if (user) {
      console.log("User is already created");
    } else {
      await prisma.user.create({
        data: {
          username: name,
          domainUsername,
          isAdmin: true,
        },
      });
      console.log("created");
    }
  } catch (error) {
    console.log(error);
  }
};

createSuperUser();
