import { app } from "@azure/functions";

const hello = () => {

  return { status: 200, body: "Hello World" };

}


app.http("status", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "status",
  handler: hello
});
