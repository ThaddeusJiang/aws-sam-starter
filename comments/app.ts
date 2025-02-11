import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
  UpdateCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import { z } from 'zod';

// Zod schemas
const CommentSchema = z.object({
  id: z.string(),
  content: z.string().min(1, '评论内容不能为空').max(1000, '评论内容不能超过1000个字符'),
  author: z.string().min(1, '作者名不能为空').max(50, '作者名不能超过50个字符'),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const CreateCommentSchema = z.object({
  content: z.string().min(1, '评论内容不能为空').max(1000, '评论内容不能超过1000个字符'),
  author: z.string().min(1, '作者名不能为空').max(50, '作者名不能超过50个字符'),
});

const UpdateCommentSchema = z
  .object({
    content: z
      .string()
      .min(1, '评论内容不能为空')
      .max(1000, '评论内容不能超过1000个字符')
      .optional(),
    author: z.string().min(1, '作者名不能为空').max(50, '作者名不能超过50个字符').optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: '至少需要更新一个字段',
  });

// Types from Zod schemas
type Comment = z.infer<typeof CommentSchema>;
type CreateCommentInput = z.infer<typeof CreateCommentSchema>;
type UpdateCommentInput = z.infer<typeof UpdateCommentSchema>;

const client = new DynamoDBClient({});
const ddbDocClient = DynamoDBDocumentClient.from(client);
const tableName = process.env.TABLE_NAME || 'CommentsTable';

/**
 *
 * Event doc: https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html#api-gateway-simple-proxy-for-lambda-input-format
 * @param {Object} event - API Gateway Lambda Proxy Input Format
 *
 * Return doc: https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html
 * @returns {Object} object - API Gateway Lambda Proxy Output Format
 *
 */

export const lambdaHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  try {
    const { httpMethod, body, pathParameters } = event;
    let response;

    switch (httpMethod) {
      case 'GET':
        if (pathParameters?.id) {
          response = await getItem(pathParameters.id);
        } else {
          response = await listItems();
        }
        break;
      case 'POST':
        const createInput = CreateCommentSchema.parse(JSON.parse(body || '{}'));
        response = await createItem(createInput);
        break;
      case 'PUT':
        const updateInput = UpdateCommentSchema.parse(JSON.parse(body || '{}'));
        response = await updateItem(pathParameters?.id, updateInput);
        break;
      case 'DELETE':
        response = await deleteItem(pathParameters?.id);
        break;
      default:
        response = {
          statusCode: 405,
          body: JSON.stringify({ message: 'Method Not Allowed' }),
        };
    }

    return response;
  } catch (err) {
    console.log(err);
    if (err instanceof z.ZodError) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          message: '输入验证失败',
          errors: err.errors,
        }),
      };
    }
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'some error happened',
      }),
    };
  }
};

const getItem = async (id: string | undefined): Promise<APIGatewayProxyResult> => {
  if (!id) {
    return {
      statusCode: 400,
      body: JSON.stringify({ message: 'ID is required' }),
    };
  }

  const params = {
    TableName: tableName,
    Key: { id },
  };

  const { Item } = await ddbDocClient.send(new GetCommand(params));

  if (!Item) {
    return {
      statusCode: 404,
      body: JSON.stringify({ message: '评论不存在' }),
    };
  }

  const comment = CommentSchema.parse(Item);
  return {
    statusCode: 200,
    body: JSON.stringify(comment),
  };
};

const createItem = async (input: CreateCommentInput): Promise<APIGatewayProxyResult> => {
  const timestamp = new Date().toISOString();
  const item: Comment = {
    id: Date.now().toString(),
    content: input.content,
    author: input.author,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const params = {
    TableName: tableName,
    Item: item,
  };

  await ddbDocClient.send(new PutCommand(params));

  return {
    statusCode: 201,
    body: JSON.stringify(item),
  };
};

const updateItem = async (
  id: string | undefined,
  input: UpdateCommentInput
): Promise<APIGatewayProxyResult> => {
  if (!id) {
    return {
      statusCode: 400,
      body: JSON.stringify({ message: 'ID is required' }),
    };
  }

  // 首先检查项目是否存在
  const getParams = {
    TableName: tableName,
    Key: { id },
  };

  const { Item } = await ddbDocClient.send(new GetCommand(getParams));

  if (!Item) {
    return {
      statusCode: 404,
      body: JSON.stringify({ message: '评论不存在' }),
    };
  }

  const updateExpressions: string[] = [];
  const expressionAttributeNames: { [key: string]: string } = {};
  const expressionAttributeValues: { [key: string]: string | undefined } = {};

  // 添加更新时间
  updateExpressions.push('#updatedAt = :updatedAt');
  expressionAttributeNames['#updatedAt'] = 'updatedAt';
  expressionAttributeValues[':updatedAt'] = new Date().toISOString();

  // 处理可选字段
  if (input.content !== undefined) {
    updateExpressions.push('#content = :content');
    expressionAttributeNames['#content'] = 'content';
    expressionAttributeValues[':content'] = input.content;
  }

  if (input.author !== undefined) {
    updateExpressions.push('#author = :author');
    expressionAttributeNames['#author'] = 'author';
    expressionAttributeValues[':author'] = input.author;
  }

  const params = {
    TableName: tableName,
    Key: { id },
    UpdateExpression: `set ${updateExpressions.join(', ')}`,
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
    ReturnValues: 'ALL_NEW' as const,
  };

  const { Attributes } = await ddbDocClient.send(new UpdateCommand(params));
  const updatedComment = CommentSchema.parse(Attributes);

  return {
    statusCode: 200,
    body: JSON.stringify(updatedComment),
  };
};

const deleteItem = async (id: string | undefined) => {
  if (!id) {
    return {
      statusCode: 400,
      body: JSON.stringify({ message: 'ID is required' }),
    };
  }

  const params = {
    TableName: tableName,
    Key: { id },
  };

  await ddbDocClient.send(new DeleteCommand(params));

  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'Item deleted successfully' }),
  };
};

const listItems = async (): Promise<APIGatewayProxyResult> => {
  const params = {
    TableName: tableName,
  };

  const { Items } = await ddbDocClient.send(new ScanCommand(params));

  if (!Items) {
    return {
      statusCode: 200,
      body: JSON.stringify([]),
    };
  }

  const comments = z.array(CommentSchema).parse(Items);
  return {
    statusCode: 200,
    body: JSON.stringify(comments),
  };
};
